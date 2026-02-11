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


def _build_statement_breakdown(
    *,
    organization_id: str,
    period_start: str,
    period_end: str,
    property_id: Optional[str] = None,
    unit_id: Optional[str] = None,
) -> dict:
    start = _parse_date(period_start)
    end = _parse_date(period_end)

    allowed_unit_ids: Optional[set[str]] = None
    if property_id:
        units = list_rows(
            "units",
            {"organization_id": organization_id, "property_id": property_id},
            limit=3000,
        )
        allowed_unit_ids = {str(unit.get("id") or "") for unit in units if unit.get("id")}

    reservations = list_rows("reservations", {"organization_id": organization_id}, limit=5000)
    reservations = [item for item in reservations if item.get("status") in REPORTABLE_STATUSES]
    if unit_id:
        reservations = [item for item in reservations if item.get("unit_id") == unit_id]
    elif allowed_unit_ids is not None:
        reservations = [item for item in reservations if item.get("unit_id") in allowed_unit_ids]

    expenses = list_rows("expenses", {"organization_id": organization_id}, limit=5000)
    if unit_id:
        expenses = [item for item in expenses if item.get("unit_id") == unit_id]
    elif property_id:
        expenses = [
            item
            for item in expenses
            if item.get("property_id") == property_id
            or (allowed_unit_ids is not None and item.get("unit_id") in allowed_unit_ids)
        ]

    leases = list_rows("leases", {"organization_id": organization_id}, limit=6000)
    if unit_id:
        leases = [item for item in leases if item.get("unit_id") == unit_id]
    elif allowed_unit_ids is not None:
        leases = [item for item in leases if item.get("unit_id") in allowed_unit_ids]
    elif property_id:
        leases = [item for item in leases if item.get("property_id") == property_id]

    lease_index = {str(item.get("id") or ""): item for item in leases if item.get("id")}
    lease_ids = [key for key in lease_index.keys() if key]

    lease_charges = list_rows("lease_charges", {"organization_id": organization_id}, limit=15000)
    if lease_ids:
        lease_charges = [item for item in lease_charges if item.get("lease_id") in lease_ids]
    else:
        lease_charges = []

    collections = list_rows("collection_records", {"organization_id": organization_id}, limit=15000)
    if lease_ids:
        collections = [item for item in collections if item.get("lease_id") in lease_ids]
    else:
        collections = []

    line_items: list[dict] = []
    expense_warnings: dict[str, list[str]] = {}

    gross_revenue = 0.0
    platform_fees = 0.0
    taxes_collected = 0.0

    for reservation in reservations:
        reservation_start = _parse_date(str(reservation.get("check_in_date")))
        reservation_end = _parse_date(str(reservation.get("check_out_date")))
        if reservation_end <= start or reservation_start > end:
            continue

        reservation_id = str(reservation.get("id") or "")
        gross_amount = float(reservation.get("total_amount") or 0)
        platform_amount = float(reservation.get("platform_fee") or 0)
        tax_amount = float(reservation.get("tax_amount") or 0)

        gross_revenue += gross_amount
        platform_fees += platform_amount
        taxes_collected += tax_amount

        if gross_amount:
            line_items.append(
                {
                    "bucket": "gross_revenue",
                    "source_table": "reservations",
                    "source_id": reservation_id,
                    "kind": "reservation_total",
                    "from": str(reservation.get("check_in_date") or ""),
                    "to": str(reservation.get("check_out_date") or ""),
                    "amount_pyg": round(gross_amount, 2),
                }
            )

        if platform_amount:
            line_items.append(
                {
                    "bucket": "platform_fees",
                    "source_table": "reservations",
                    "source_id": reservation_id,
                    "kind": "reservation_platform_fee",
                    "amount_pyg": round(platform_amount, 2),
                }
            )

        if tax_amount:
            line_items.append(
                {
                    "bucket": "taxes_collected",
                    "source_table": "reservations",
                    "source_id": reservation_id,
                    "kind": "reservation_tax",
                    "amount_pyg": round(tax_amount, 2),
                }
            )

    operating_expenses = 0.0
    for expense in expenses:
        expense_date = _parse_date(str(expense.get("expense_date")))
        if not (start <= expense_date <= end):
            continue

        amount_pyg, warning = _expense_amount_pyg(expense)
        operating_expenses += amount_pyg
        expense_id = str(expense.get("id") or "")
        if warning:
            expense_warnings.setdefault(warning, []).append(expense_id)

        line_items.append(
            {
                "bucket": "operating_expenses",
                "source_table": "expenses",
                "source_id": expense_id,
                "kind": str(expense.get("category") or "expense"),
                "date": str(expense.get("expense_date") or ""),
                "amount_pyg": round(amount_pyg, 2),
            }
        )

    lease_collections = 0.0
    paid_lease_ids: set[str] = set()
    for collection in collections:
        if str(collection.get("status") or "") != "paid":
            continue

        paid_at = collection.get("paid_at")
        if isinstance(paid_at, str) and paid_at:
            paid_on = _parse_date(paid_at[:10])
        else:
            paid_on = _parse_date(str(collection.get("due_date")))

        if not (start <= paid_on <= end):
            continue

        amount_pyg, warning = _generic_amount_pyg(collection, amount_key="amount")
        lease_collections += amount_pyg
        collection_id = str(collection.get("id") or "")
        if warning:
            expense_warnings.setdefault(warning, []).append(collection_id)

        lease_id = str(collection.get("lease_id") or "")
        if lease_id:
            paid_lease_ids.add(lease_id)

        line_items.append(
            {
                "bucket": "lease_collections",
                "source_table": "collection_records",
                "source_id": collection_id,
                "kind": "collection_paid",
                "date": paid_on.isoformat(),
                "amount_pyg": round(amount_pyg, 2),
            }
        )

    service_fees = 0.0
    for charge in lease_charges:
        charge_date = _parse_date(str(charge.get("charge_date")))
        if not (start <= charge_date <= end):
            continue

        charge_type = str(charge.get("charge_type") or "")
        if charge_type not in {"service_fee_flat", "admin_fee"}:
            continue

        amount_pyg, warning = _generic_amount_pyg(charge, amount_key="amount")
        service_fees += amount_pyg
        charge_id = str(charge.get("id") or "")
        if warning:
            expense_warnings.setdefault(warning, []).append(charge_id)

        line_items.append(
            {
                "bucket": "service_fees",
                "source_table": "lease_charges",
                "source_id": charge_id,
                "kind": charge_type,
                "date": str(charge.get("charge_date") or ""),
                "amount_pyg": round(amount_pyg, 2),
            }
        )

    collection_fees = 0.0
    for lease_id in paid_lease_ids:
        lease = lease_index.get(lease_id) or {}
        platform_fee = float(lease.get("platform_fee", 0) or 0)
        collection_fees += platform_fee
        line_items.append(
            {
                "bucket": "collection_fees",
                "source_table": "leases",
                "source_id": lease_id,
                "kind": "platform_fee_per_paid_lease",
                "amount_pyg": round(platform_fee, 2),
            }
        )

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

    return {
        "gross_revenue": round(gross_revenue, 2),
        "lease_collections": round(lease_collections, 2),
        "service_fees": round(service_fees, 2),
        "collection_fees": round(collection_fees, 2),
        "platform_fees": round(platform_fees, 2),
        "taxes_collected": round(taxes_collected, 2),
        "operating_expenses": round(operating_expenses, 2),
        "net_payout": round(net_payout, 2),
        "line_items": line_items,
        "reconciliation": {
            "gross_total": round(gross_total, 2),
            "computed_net_payout": round(net_payout, 2),
        },
    }


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
    breakdown = _build_statement_breakdown(
        organization_id=payload.organization_id,
        period_start=payload.period_start,
        period_end=payload.period_end,
        property_id=payload.property_id,
        unit_id=payload.unit_id,
    )

    statement = payload.model_dump(exclude_none=True)
    statement.update(
        {
            "gross_revenue": breakdown["gross_revenue"],
            "lease_collections": breakdown["lease_collections"],
            "service_fees": breakdown["service_fees"],
            "collection_fees": breakdown["collection_fees"],
            "platform_fees": breakdown["platform_fees"],
            "taxes_collected": breakdown["taxes_collected"],
            "operating_expenses": breakdown["operating_expenses"],
            "net_payout": breakdown["net_payout"],
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

    response = {**created}
    response["line_items"] = breakdown["line_items"]
    response["reconciliation"] = {
        **breakdown["reconciliation"],
        "stored_net_payout": breakdown["net_payout"],
        "stored_vs_computed_diff": 0.0,
    }
    return response


@router.get("/owner-statements/{statement_id}")
def get_owner_statement(statement_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("owner_statements", statement_id)
    assert_org_member(user_id, record["organization_id"])
    enriched = enrich_owner_statements([record], record["organization_id"])[0]

    breakdown = _build_statement_breakdown(
        organization_id=str(record.get("organization_id") or ""),
        period_start=str(record.get("period_start") or ""),
        period_end=str(record.get("period_end") or ""),
        property_id=str(record.get("property_id") or "") or None,
        unit_id=str(record.get("unit_id") or "") or None,
    )
    stored_net = round(float(record.get("net_payout", 0) or 0), 2)

    enriched["line_items"] = breakdown["line_items"]
    enriched["reconciliation"] = {
        **breakdown["reconciliation"],
        "stored_net_payout": stored_net,
        "stored_vs_computed_diff": round(stored_net - breakdown["reconciliation"]["computed_net_payout"], 2),
    }
    return enriched


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
