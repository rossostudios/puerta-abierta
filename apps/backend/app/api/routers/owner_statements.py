from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import CreateOwnerStatementInput
from app.services.audit import write_audit_log
from app.services.enrichment import enrich_owner_statements
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Owner Statements"])

REPORTABLE_STATUSES = {"confirmed", "checked_in", "checked_out"}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _sum_in_period(records: list[dict], amount_key: str, from_key: str, to_key: str, period_start: date, period_end: date) -> float:
    total = 0.0
    for record in records:
        rec_start = _parse_date(record[from_key])
        rec_end = _parse_date(record[to_key])
        if rec_end <= period_start or rec_start > period_end:
            continue
        total += float(record.get(amount_key, 0) or 0)
    return total


def _expense_amount_pyg(expense: dict) -> tuple[float, Optional[str]]:
    """Return (amount_in_pyg, warning_code)."""

    currency = str(expense.get("currency") or "PYG").strip().upper()
    amount = float(expense.get("amount", 0) or 0)
    if currency == "PYG":
        return amount, None
    if currency == "USD":
        fx = expense.get("fx_rate_to_pyg")
        try:
            fx_value = float(fx)
        except Exception:  # pragma: no cover
            return 0.0, "missing_fx_rate_to_pyg"
        if fx_value <= 0:  # pragma: no cover
            return 0.0, "missing_fx_rate_to_pyg"
        return amount * fx_value, None
    return 0.0, f"unsupported_currency:{currency}"


def _generic_amount_pyg(record: dict, amount_key: str = "amount") -> tuple[float, Optional[str]]:
    currency = str(record.get("currency") or "PYG").strip().upper()
    amount = float(record.get(amount_key, 0) or 0)
    if currency == "PYG":
        return amount, None
    # Collection and lease charge records do not currently store FX snapshots.
    return 0.0, f"unsupported_currency:{currency}"


@router.get("/owner-statements")
def list_owner_statements(
    org_id: str = Query(...),
    status: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    limit: int = Query(120, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)
    filters = {"organization_id": org_id}
    if status:
        filters["status"] = status
    if property_id:
        filters["property_id"] = property_id
    if unit_id:
        filters["unit_id"] = unit_id
    rows = list_rows("owner_statements", filters, limit=limit, order_by="period_start", ascending=False)
    return {"data": enrich_owner_statements(rows, org_id)}


@router.post("/owner-statements", status_code=201)
def create_owner_statement(payload: CreateOwnerStatementInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, {"owner_admin", "accountant"})
    start = _parse_date(payload.period_start)
    end = _parse_date(payload.period_end)

    allowed_unit_ids: Optional[set[str]] = None
    if payload.property_id:
        units = list_rows(
            "units",
            {"organization_id": payload.organization_id, "property_id": payload.property_id},
            limit=3000,
        )
        allowed_unit_ids = {unit["id"] for unit in units}

    reservations = list_rows("reservations", {"organization_id": payload.organization_id}, limit=5000)
    reservations = [item for item in reservations if item.get("status") in REPORTABLE_STATUSES]
    if payload.unit_id:
        reservations = [item for item in reservations if item.get("unit_id") == payload.unit_id]
    elif allowed_unit_ids is not None:
        reservations = [item for item in reservations if item.get("unit_id") in allowed_unit_ids]

    expenses = list_rows("expenses", {"organization_id": payload.organization_id}, limit=5000)
    if payload.unit_id:
        expenses = [item for item in expenses if item.get("unit_id") == payload.unit_id]
    elif payload.property_id:
        expenses = [
            item
            for item in expenses
            if item.get("property_id") == payload.property_id
            or (allowed_unit_ids is not None and item.get("unit_id") in allowed_unit_ids)
        ]

    gross_revenue = _sum_in_period(reservations, "total_amount", "check_in_date", "check_out_date", start, end)
    platform_fees = _sum_in_period(reservations, "platform_fee", "check_in_date", "check_out_date", start, end)
    taxes_collected = _sum_in_period(reservations, "tax_amount", "check_in_date", "check_out_date", start, end)

    leases = list_rows("leases", {"organization_id": payload.organization_id}, limit=6000)
    if payload.unit_id:
        leases = [item for item in leases if item.get("unit_id") == payload.unit_id]
    elif allowed_unit_ids is not None:
        leases = [item for item in leases if item.get("unit_id") in allowed_unit_ids]
    elif payload.property_id:
        leases = [item for item in leases if item.get("property_id") == payload.property_id]

    lease_index = {str(item.get("id") or ""): item for item in leases if item.get("id")}
    lease_ids = [key for key in lease_index.keys() if key]

    lease_charges = list_rows("lease_charges", {"organization_id": payload.organization_id}, limit=15000)
    if lease_ids:
        lease_charges = [item for item in lease_charges if item.get("lease_id") in lease_ids]
    else:
        lease_charges = []

    collections = list_rows("collection_records", {"organization_id": payload.organization_id}, limit=15000)
    if lease_ids:
        collections = [item for item in collections if item.get("lease_id") in lease_ids]
    else:
        collections = []

    operating_expenses = 0.0
    expense_warnings: dict[str, list[str]] = {}
    for expense in expenses:
        expense_date = _parse_date(expense["expense_date"])
        if start <= expense_date <= end:
            amount_pyg, warning = _expense_amount_pyg(expense)
            operating_expenses += amount_pyg
            if warning:
                expense_id = str(expense.get("id") or "")
                expense_warnings.setdefault(warning, []).append(expense_id)

    lease_collections = 0.0
    service_fees = 0.0
    collection_fees = 0.0
    paid_lease_ids: set[str] = set()

    for collection in collections:
        if str(collection.get("status") or "") != "paid":
            continue

        paid_at = collection.get("paid_at")
        if isinstance(paid_at, str) and paid_at:
            paid_on = _parse_date(paid_at[:10])
        else:
            paid_on = _parse_date(collection["due_date"])

        if not (start <= paid_on <= end):
            continue

        amount_pyg, warning = _generic_amount_pyg(collection, amount_key="amount")
        lease_collections += amount_pyg
        if warning:
            collection_id = str(collection.get("id") or "")
            expense_warnings.setdefault(warning, []).append(collection_id)

        lease_id = str(collection.get("lease_id") or "")
        if lease_id:
            paid_lease_ids.add(lease_id)

    for charge in lease_charges:
        charge_date = _parse_date(charge["charge_date"])
        if not (start <= charge_date <= end):
            continue
        charge_type = str(charge.get("charge_type") or "")
        if charge_type not in {"service_fee_flat", "admin_fee"}:
            continue
        amount_pyg, warning = _generic_amount_pyg(charge, amount_key="amount")
        service_fees += amount_pyg
        if warning:
            charge_id = str(charge.get("id") or "")
            expense_warnings.setdefault(warning, []).append(charge_id)

    for lease_id in paid_lease_ids:
        lease = lease_index.get(lease_id) or {}
        collection_fees += float(lease.get("platform_fee", 0) or 0)

    if expense_warnings:
        missing = len(expense_warnings.get("missing_fx_rate_to_pyg", []))
        unsupported = sum(
            len(ids)
            for key, ids in expense_warnings.items()
            if key.startswith("unsupported_currency:")
        )
        samples = []
        for ids in expense_warnings.values():
            for expense_id in ids:
                if expense_id and expense_id not in samples:
                    samples.append(expense_id)
                if len(samples) >= 8:
                    break
            if len(samples) >= 8:
                break

        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot compute operating expenses in PYG for this period. "
                f"missing_fx_rate_to_pyg={missing}, unsupported_currency={unsupported}. "
                f"Fix the underlying expenses (sample ids: {', '.join(samples) or 'n/a'})."
            ),
        )

    gross_total = gross_revenue + lease_collections
    net_payout = gross_total - platform_fees - service_fees - collection_fees - operating_expenses

    statement = payload.model_dump(exclude_none=True)
    statement.update(
        {
            "gross_revenue": round(gross_revenue, 2),
            "lease_collections": round(lease_collections, 2),
            "service_fees": round(service_fees, 2),
            "collection_fees": round(collection_fees, 2),
            "platform_fees": round(platform_fees, 2),
            "taxes_collected": round(taxes_collected, 2),
            "operating_expenses": round(operating_expenses, 2),
            "net_payout": round(net_payout, 2),
            "status": "draft",
        }
    )
    created = create_row("owner_statements", statement)
    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="owner_statements",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )
    return created


@router.get("/owner-statements/{statement_id}")
def get_owner_statement(statement_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("owner_statements", statement_id)
    assert_org_member(user_id, record["organization_id"])
    return enrich_owner_statements([record], record["organization_id"])[0]


@router.post("/owner-statements/{statement_id}/finalize")
def finalize_owner_statement(statement_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("owner_statements", statement_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "accountant"})
    updated = update_row("owner_statements", statement_id, {"status": "finalized"})
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="status_transition",
        entity_name="owner_statements",
        entity_id=statement_id,
        before_state=record,
        after_state=updated,
    )
    return updated
