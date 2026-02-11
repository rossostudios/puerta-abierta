from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import CreateCollectionInput, MarkCollectionPaidInput
from app.services.analytics import write_analytics_event
from app.services.audit import write_audit_log
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Collections"])

COLLECTION_EDIT_ROLES = {"owner_admin", "operator", "accountant"}


def _enrich(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    lease_ids = [str(row.get("lease_id") or "") for row in rows if row.get("lease_id")]

    lease_index: dict[str, dict] = {}
    if lease_ids:
        leases = list_rows("leases", {"id": lease_ids}, limit=max(200, len(lease_ids)))
        for lease in leases:
            lease_id = lease.get("id")
            if isinstance(lease_id, str):
                lease_index[lease_id] = lease

    for row in rows:
        lease = lease_index.get(str(row.get("lease_id") or ""))
        if not lease:
            continue
        row["tenant_full_name"] = lease.get("tenant_full_name")
        row["lease_status"] = lease.get("lease_status")
        row["property_id"] = lease.get("property_id")
        row["unit_id"] = lease.get("unit_id")

    return rows


def _refresh_lease_status(lease_id: str) -> None:
    lease = get_row("leases", lease_id)
    status = str(lease.get("lease_status") or "")
    if status not in {"active", "delinquent"}:
        return

    today_iso = datetime.now(timezone.utc).date().isoformat()
    unpaid = list_rows(
        "collection_records",
        {
            "lease_id": lease_id,
            "status": ["scheduled", "pending", "late"],
        },
        limit=500,
    )

    has_overdue = any(
        str(row.get("due_date") or "") and str(row.get("due_date")) < today_iso
        for row in unpaid
    )

    next_status = "delinquent" if has_overdue else "active"
    if next_status != status:
        update_row("leases", lease_id, {"lease_status": next_status})


@router.get("/collections")
def list_collections(
    org_id: str = Query(...),
    status: Optional[str] = Query(None),
    lease_id: Optional[str] = Query(None),
    due_from: Optional[str] = Query(None),
    due_to: Optional[str] = Query(None),
    limit: int = Query(400, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    filters = {"organization_id": org_id}
    if status:
        filters["status"] = status
    if lease_id:
        filters["lease_id"] = lease_id

    rows = list_rows("collection_records", filters, limit=limit)

    if due_from:
        rows = [row for row in rows if str(row.get("due_date") or "") >= due_from]
    if due_to:
        rows = [row for row in rows if str(row.get("due_date") or "") <= due_to]

    return {"data": _enrich(rows)}


@router.post("/collections", status_code=201)
def create_collection(payload: CreateCollectionInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, COLLECTION_EDIT_ROLES)

    lease = get_row("leases", payload.lease_id)
    if lease.get("organization_id") != payload.organization_id:
        raise HTTPException(status_code=400, detail="lease_id does not belong to this organization.")

    record = payload.model_dump(exclude_none=True)
    record["created_by_user_id"] = user_id

    created = create_row("collection_records", record)

    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="collection_records",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )

    _refresh_lease_status(payload.lease_id)

    return _enrich([created])[0]


@router.get("/collections/{collection_id}")
def get_collection(collection_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("collection_records", collection_id)
    assert_org_member(user_id, record["organization_id"])
    return _enrich([record])[0]


@router.post("/collections/{collection_id}/mark-paid")
def mark_collection_paid(
    collection_id: str,
    payload: MarkCollectionPaidInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("collection_records", collection_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, COLLECTION_EDIT_ROLES)

    now_iso = datetime.now(timezone.utc).isoformat()

    patch = {
        "status": "paid",
        "paid_at": payload.paid_at or now_iso,
    }
    if payload.payment_method is not None:
        patch["payment_method"] = payload.payment_method
    if payload.payment_reference is not None:
        patch["payment_reference"] = payload.payment_reference
    if payload.notes is not None:
        patch["notes"] = payload.notes

    updated = update_row("collection_records", collection_id, patch)

    lease_charge_id = updated.get("lease_charge_id")
    if isinstance(lease_charge_id, str) and lease_charge_id:
        try:
            update_row("lease_charges", lease_charge_id, {"status": "paid"})
        except Exception:
            pass

    lease_id = str(updated.get("lease_id") or "")
    if lease_id:
        _refresh_lease_status(lease_id)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="status_transition",
        entity_name="collection_records",
        entity_id=collection_id,
        before_state=record,
        after_state=updated,
    )

    write_analytics_event(
        organization_id=org_id,
        event_type="collection_paid",
        payload={
            "collection_id": collection_id,
            "lease_id": updated.get("lease_id"),
            "amount": updated.get("amount"),
            "currency": updated.get("currency"),
        },
    )

    return _enrich([updated])[0]
