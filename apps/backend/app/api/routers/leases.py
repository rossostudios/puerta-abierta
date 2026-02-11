from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import CreateLeaseInput, UpdateLeaseInput
from app.services.audit import write_audit_log
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Leases"])

LEASE_EDIT_ROLES = {"owner_admin", "operator", "accountant"}


def _compute_totals(record: dict) -> dict[str, float]:
    monthly_rent = float(record.get("monthly_rent") or 0)
    service_fee_flat = float(record.get("service_fee_flat") or 0)
    security_deposit = float(record.get("security_deposit") or 0)
    guarantee_option_fee = float(record.get("guarantee_option_fee") or 0)
    tax_iva = float(record.get("tax_iva") or 0)

    total_move_in = monthly_rent + service_fee_flat + security_deposit + guarantee_option_fee + tax_iva
    monthly_recurring_total = monthly_rent + tax_iva

    return {
        "total_move_in": round(total_move_in, 2),
        "monthly_recurring_total": round(monthly_recurring_total, 2),
    }


def _enrich(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    property_ids = [str(row.get("property_id") or "") for row in rows if row.get("property_id")]
    unit_ids = [str(row.get("unit_id") or "") for row in rows if row.get("unit_id")]

    property_name: dict[str, str] = {}
    if property_ids:
        properties = list_rows("properties", {"id": property_ids}, limit=max(200, len(property_ids)))
        for prop in properties:
            prop_id = prop.get("id")
            if isinstance(prop_id, str):
                property_name[prop_id] = str(prop.get("name") or "")

    unit_name: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"id": unit_ids}, limit=max(200, len(unit_ids)))
        for unit in units:
            unit_id = unit.get("id")
            if isinstance(unit_id, str):
                unit_name[unit_id] = str(unit.get("name") or "")

    lease_ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    collections = list_rows(
        "collection_records",
        {"lease_id": lease_ids},
        limit=max(300, len(lease_ids) * 12),
    ) if lease_ids else []

    collection_stats: dict[str, dict[str, float]] = {}
    for collection in collections:
        lease_id = collection.get("lease_id")
        if not isinstance(lease_id, str):
            continue
        stats = collection_stats.setdefault(
            lease_id,
            {"count": 0, "paid_count": 0, "amount": 0.0, "paid_amount": 0.0},
        )
        amount = float(collection.get("amount") or 0)
        stats["count"] += 1
        stats["amount"] += amount
        if str(collection.get("status") or "") == "paid":
            stats["paid_count"] += 1
            stats["paid_amount"] += amount

    for row in rows:
        pid = row.get("property_id")
        uid = row.get("unit_id")
        if isinstance(pid, str):
            row["property_name"] = property_name.get(pid)
        if isinstance(uid, str):
            row["unit_name"] = unit_name.get(uid)

        stats = collection_stats.get(str(row.get("id") or ""), {})
        row["collection_count"] = int(stats.get("count") or 0)
        row["collection_paid_count"] = int(stats.get("paid_count") or 0)
        row["collection_amount_total"] = round(float(stats.get("amount") or 0), 2)
        row["collection_amount_paid"] = round(float(stats.get("paid_amount") or 0), 2)

    return rows


@router.get("/leases")
def list_leases(
    org_id: str = Query(...),
    lease_status: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    limit: int = Query(300, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    filters = {"organization_id": org_id}
    if lease_status:
        filters["lease_status"] = lease_status
    if property_id:
        filters["property_id"] = property_id
    if unit_id:
        filters["unit_id"] = unit_id

    rows = list_rows("leases", filters, limit=limit)
    return {"data": _enrich(rows)}


@router.post("/leases", status_code=201)
def create_lease(payload: CreateLeaseInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, LEASE_EDIT_ROLES)

    lease_payload = payload.model_dump(exclude={"charges", "generate_first_collection", "first_collection_due_date"}, exclude_none=True)
    lease_payload["created_by_user_id"] = user_id
    lease_payload.update(_compute_totals(lease_payload))

    lease = create_row("leases", lease_payload)

    for charge in payload.charges:
        charge_payload = charge.model_dump(exclude_none=True)
        create_row(
            "lease_charges",
            {
                "organization_id": payload.organization_id,
                "lease_id": lease.get("id"),
                **charge_payload,
            },
        )

    first_collection = None
    if payload.generate_first_collection:
        due_date = payload.first_collection_due_date or payload.starts_on
        first_collection = create_row(
            "collection_records",
            {
                "organization_id": payload.organization_id,
                "lease_id": lease.get("id"),
                "due_date": due_date,
                "amount": lease_payload["monthly_recurring_total"],
                "currency": payload.currency,
                "status": "scheduled",
                "created_by_user_id": user_id,
            },
        )

    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="leases",
        entity_id=lease.get("id"),
        before_state=None,
        after_state={"lease": lease, "first_collection": first_collection},
    )

    return {
        "lease": _enrich([lease])[0],
        "first_collection": first_collection,
    }


@router.get("/leases/{lease_id}")
def get_lease(lease_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("leases", lease_id)
    assert_org_member(user_id, record["organization_id"])

    charges = list_rows(
        "lease_charges",
        {"lease_id": lease_id},
        limit=500,
        order_by="charge_date",
        ascending=True,
    )
    collections = list_rows(
        "collection_records",
        {"lease_id": lease_id},
        limit=500,
        order_by="due_date",
        ascending=True,
    )

    enriched = _enrich([record])[0]
    enriched["charges"] = charges
    enriched["collections"] = collections
    return enriched


@router.patch("/leases/{lease_id}")
def update_lease(
    lease_id: str,
    payload: UpdateLeaseInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("leases", lease_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, LEASE_EDIT_ROLES)

    patch = payload.model_dump(exclude_none=True)

    if patch:
        merged = {**record, **patch}
        if any(
            key in patch
            for key in {
                "monthly_rent",
                "service_fee_flat",
                "security_deposit",
                "guarantee_option_fee",
                "tax_iva",
            }
        ):
            patch.update(_compute_totals(merged))

    updated = update_row("leases", lease_id, patch)

    if str(updated.get("lease_status") or "") == "active":
        unpaid_past_due = list_rows(
            "collection_records",
            {
                "lease_id": lease_id,
                "status": ["scheduled", "pending", "late"],
            },
            limit=200,
        )
        now_date = datetime.now(timezone.utc).date()
        has_overdue = any(
            str(row.get("due_date") or "") and str(row.get("due_date")) < now_date.isoformat()
            for row in unpaid_past_due
        )
        if has_overdue:
            updated = update_row("leases", lease_id, {"lease_status": "delinquent"})

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="update",
        entity_name="leases",
        entity_id=lease_id,
        before_state=record,
        after_state=updated,
    )

    return _enrich([updated])[0]
