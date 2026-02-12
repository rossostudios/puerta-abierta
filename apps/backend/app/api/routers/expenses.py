from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.db.supabase import get_supabase_client
from app.schemas.domain import CreateExpenseInput, UpdateExpenseInput
from app.services.audit import write_audit_log
from app.services.enrichment import enrich_expenses
from app.services.fx import get_usd_to_pyg_rate
from app.services.table_service import create_row, delete_row, get_row, update_row

router = APIRouter(tags=["Expenses"])


@router.get("/expenses")
def list_expenses(
    org_id: str = Query(...),
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    category: Optional[str] = Query(None),
    currency: Optional[str] = Query(None),
    payment_method: Optional[str] = Query(None),
    vendor_name: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    reservation_id: Optional[str] = Query(None),
    limit: int = Query(300, ge=1, le=2000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    try:
        client = get_supabase_client()
        query = client.table("expenses").select("*").eq("organization_id", org_id)

        if category:
            query = query.eq("category", category)
        if currency:
            query = query.eq("currency", currency)
        if payment_method:
            query = query.eq("payment_method", payment_method)
        if property_id:
            query = query.eq("property_id", property_id)
        if unit_id:
            query = query.eq("unit_id", unit_id)
        if reservation_id:
            query = query.eq("reservation_id", reservation_id)
        if from_date:
            query = query.gte("expense_date", from_date)
        if to_date:
            query = query.lte("expense_date", to_date)
        if vendor_name:
            query = query.ilike("vendor_name", f"%{vendor_name.strip()}%")

        # Pagination: offset/limit isn't exposed on this endpoint yet. Keep it simple.
        query = query.order("expense_date", desc=True).range(0, limit - 1)
        response = query.execute()
        rows = response.data or []
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise HTTPException(status_code=502, detail=f"Supabase request failed: {exc}") from exc

    return {"data": enrich_expenses(rows, org_id)}


@router.post("/expenses", status_code=201)
def create_expense(payload: CreateExpenseInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, {"owner_admin", "accountant"})

    record = payload.model_dump(exclude_none=True)
    record["created_by_user_id"] = user_id

    receipt_url = str(record.get("receipt_url") or "").strip()
    if not receipt_url:
        raise HTTPException(status_code=400, detail="receipt_url is required.")
    record["receipt_url"] = receipt_url

    reservation_id = str(record.get("reservation_id") or "").strip()
    if reservation_id:
        reservation = get_row("reservations", reservation_id)
        if reservation.get("organization_id") != payload.organization_id:
            raise HTTPException(status_code=400, detail="reservation_id does not belong to this organization.")

        unit_id = reservation.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id.strip():
            raise HTTPException(status_code=400, detail="reservation_id is missing unit_id.")
        record["unit_id"] = unit_id

        unit = get_row("units", unit_id)
        if unit.get("organization_id") != payload.organization_id:
            raise HTTPException(status_code=400, detail="reservation unit does not belong to this organization.")
        property_id = unit.get("property_id")
        if isinstance(property_id, str) and property_id.strip():
            record["property_id"] = property_id

    currency = str(record.get("currency") or "PYG").strip().upper()
    record["currency"] = currency
    if currency == "USD":
        fx_rate = record.get("fx_rate_to_pyg")
        if fx_rate is None:
            fetched = get_usd_to_pyg_rate(payload.expense_date)
            if fetched is None:
                raise HTTPException(
                    status_code=400,
                    detail="fx_rate_to_pyg is required for USD expenses (auto-fetch failed).",
                )
            record["fx_rate_to_pyg"] = fetched
    else:
        # Keep data consistent: we only store fx_rate_to_pyg for USD expenses.
        record.pop("fx_rate_to_pyg", None)

    created = create_row("expenses", record)
    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="expenses",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )
    return enrich_expenses([created], payload.organization_id)[0]


@router.get("/expenses/{expense_id}")
def get_expense(expense_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("expenses", expense_id)
    assert_org_member(user_id, record["organization_id"])
    return enrich_expenses([record], record["organization_id"])[0]


@router.patch("/expenses/{expense_id}")
def update_expense(expense_id: str, payload: UpdateExpenseInput, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("expenses", expense_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "accountant"})

    patch = payload.model_dump(exclude_none=True)

    if "receipt_url" in patch:
        receipt_url = str(patch.get("receipt_url") or "").strip()
        if not receipt_url:
            raise HTTPException(status_code=400, detail="receipt_url cannot be empty.")
        patch["receipt_url"] = receipt_url

    reservation_id = str(patch.get("reservation_id") or "").strip() if "reservation_id" in patch else ""
    if reservation_id:
        reservation = get_row("reservations", reservation_id)
        if reservation.get("organization_id") != record["organization_id"]:
            raise HTTPException(status_code=400, detail="reservation_id does not belong to this organization.")

        unit_id = reservation.get("unit_id")
        if not isinstance(unit_id, str) or not unit_id.strip():
            raise HTTPException(status_code=400, detail="reservation_id is missing unit_id.")
        patch["unit_id"] = unit_id

        unit = get_row("units", unit_id)
        if unit.get("organization_id") != record["organization_id"]:
            raise HTTPException(status_code=400, detail="reservation unit does not belong to this organization.")
        property_id = unit.get("property_id")
        if isinstance(property_id, str) and property_id.strip():
            patch["property_id"] = property_id

    currency = None
    if "currency" in patch:
        currency = str(patch.get("currency") or "").strip().upper()
        if not currency:
            raise HTTPException(status_code=400, detail="currency cannot be empty.")
        patch["currency"] = currency

    effective_currency = currency or str(record.get("currency") or "PYG").strip().upper()
    effective_date = str(patch.get("expense_date") or record.get("expense_date") or "").strip()

    if effective_currency == "USD":
        if "fx_rate_to_pyg" not in patch and record.get("fx_rate_to_pyg") is None:
            fetched = get_usd_to_pyg_rate(effective_date)
            if fetched is None:
                raise HTTPException(
                    status_code=400,
                    detail="fx_rate_to_pyg is required for USD expenses (auto-fetch failed).",
                )
            patch["fx_rate_to_pyg"] = fetched
    else:
        # Ensure non-USD expenses don't keep stale FX snapshots.
        patch["fx_rate_to_pyg"] = None

    updated = update_row("expenses", expense_id, patch)
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="update",
        entity_name="expenses",
        entity_id=expense_id,
        before_state=record,
        after_state=updated,
    )
    return enrich_expenses([updated], record["organization_id"])[0]


@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("expenses", expense_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "accountant"})
    deleted = delete_row("expenses", expense_id)
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="delete",
        entity_name="expenses",
        entity_id=expense_id,
        before_state=deleted,
        after_state=None,
    )
    return deleted
