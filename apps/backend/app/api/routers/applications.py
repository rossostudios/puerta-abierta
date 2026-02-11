from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import ApplicationStatusInput, ConvertApplicationToLeaseInput
from app.services.analytics import write_analytics_event
from app.services.audit import write_audit_log
from app.services.pricing import lease_financials_from_lines
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Applications"])

APPLICATION_EDIT_ROLES = {"owner_admin", "operator"}

ALLOWED_STATUS_TRANSITIONS: dict[str, set[str]] = {
    "new": {"screening", "rejected", "lost"},
    "screening": {"qualified", "visit_scheduled", "rejected", "lost"},
    "qualified": {"visit_scheduled", "offer_sent", "contract_signed", "rejected", "lost"},
    "visit_scheduled": {"offer_sent", "qualified", "rejected", "lost"},
    "offer_sent": {"contract_signed", "rejected", "lost"},
    "contract_signed": {"lost"},
    "rejected": set(),
    "lost": set(),
}


def _can_transition(current: str, nxt: str) -> bool:
    if current == nxt:
        return True
    return nxt in ALLOWED_STATUS_TRANSITIONS.get(current, set())


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _enrich(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    listing_ids = [
        str(row.get("marketplace_listing_id") or "")
        for row in rows
        if row.get("marketplace_listing_id")
    ]

    listing_title: dict[str, str] = {}
    if listing_ids:
        listings = list_rows(
            "marketplace_listings",
            {"id": listing_ids},
            limit=max(200, len(listing_ids)),
        )
        for listing in listings:
            listing_id = listing.get("id")
            if isinstance(listing_id, str):
                listing_title[listing_id] = str(listing.get("title") or "")

    for row in rows:
        listing_id = row.get("marketplace_listing_id")
        if isinstance(listing_id, str):
            row["marketplace_listing_title"] = listing_title.get(listing_id)

        created_at = _parse_iso_datetime(row.get("created_at"))
        first_response_at = _parse_iso_datetime(row.get("first_response_at"))
        if created_at and first_response_at:
            elapsed = max((first_response_at - created_at).total_seconds(), 0)
            row["first_response_minutes"] = round(elapsed / 60, 2)

    return rows


def _listing_fee_lines(marketplace_listing_id: Optional[str]) -> list[dict]:
    if not marketplace_listing_id:
        return []
    return list_rows(
        "marketplace_listing_fee_lines",
        {"marketplace_listing_id": marketplace_listing_id},
        limit=300,
        order_by="sort_order",
        ascending=True,
    )


@router.get("/applications")
def list_applications(
    org_id: str = Query(...),
    status: Optional[str] = Query(None),
    assigned_user_id: Optional[str] = Query(None),
    listing_id: Optional[str] = Query(None),
    limit: int = Query(250, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    filters = {"organization_id": org_id}
    if status:
        filters["status"] = status
    if assigned_user_id:
        filters["assigned_user_id"] = assigned_user_id
    if listing_id:
        filters["marketplace_listing_id"] = listing_id

    rows = list_rows("application_submissions", filters, limit=limit)
    return {"data": _enrich(rows)}


@router.get("/applications/{application_id}")
def get_application(application_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("application_submissions", application_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_member(user_id, org_id)

    events = list_rows(
        "application_events",
        {"application_id": application_id},
        limit=300,
        order_by="created_at",
        ascending=True,
    )

    enriched = _enrich([record])[0]
    enriched["events"] = events
    return enriched


@router.post("/applications/{application_id}/status")
def update_application_status(
    application_id: str,
    payload: ApplicationStatusInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("application_submissions", application_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, APPLICATION_EDIT_ROLES)

    current = str(record.get("status") or "new")
    nxt = str(payload.status or "").strip()
    if not nxt:
        raise HTTPException(status_code=400, detail="status is required.")

    if not _can_transition(current, nxt):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid application status transition: {current} -> {nxt}.",
        )

    now_iso = datetime.now(timezone.utc).isoformat()
    patch: dict[str, object] = {"status": nxt}

    if payload.assigned_user_id is not None:
        patch["assigned_user_id"] = payload.assigned_user_id

    if nxt != "new" and not record.get("first_response_at"):
        patch["first_response_at"] = now_iso

    if nxt == "qualified" and not record.get("qualified_at"):
        patch["qualified_at"] = now_iso

    if nxt in {"rejected", "lost"}:
        patch["rejected_reason"] = payload.rejected_reason

    updated = update_row("application_submissions", application_id, patch)

    event = create_row(
        "application_events",
        {
            "organization_id": org_id,
            "application_id": application_id,
            "event_type": "status_changed",
            "event_payload": {
                "from": current,
                "to": nxt,
                "note": payload.note,
                "rejected_reason": payload.rejected_reason,
            },
            "actor_user_id": user_id,
        },
    )

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="status_transition",
        entity_name="application_submissions",
        entity_id=application_id,
        before_state=record,
        after_state=updated,
    )

    if nxt == "qualified":
        write_analytics_event(
            organization_id=org_id,
            event_type="qualify",
            payload={"application_id": application_id, "status": nxt},
        )

    response = _enrich([updated])[0]
    response["last_event_id"] = event.get("id")
    return response


@router.post("/applications/{application_id}/convert-to-lease")
def convert_application_to_lease(
    application_id: str,
    payload: ConvertApplicationToLeaseInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    application = get_row("application_submissions", application_id)
    org_id = str(application.get("organization_id") or "")
    assert_org_role(user_id, org_id, APPLICATION_EDIT_ROLES)

    current_status = str(application.get("status") or "new")
    if current_status in {"rejected", "lost"}:
        raise HTTPException(status_code=400, detail="Cannot convert rejected/lost application to lease.")

    listing = None
    listing_id = application.get("marketplace_listing_id")
    if isinstance(listing_id, str) and listing_id:
        listing = get_row("marketplace_listings", listing_id)

    financial_defaults = {
        "monthly_rent": 0.0,
        "service_fee_flat": 0.0,
        "security_deposit": 0.0,
        "guarantee_option_fee": 0.0,
        "tax_iva": 0.0,
        "total_move_in": 0.0,
        "monthly_recurring_total": 0.0,
    }

    if listing and listing.get("id"):
        fee_lines = _listing_fee_lines(str(listing.get("id") or ""))
        if fee_lines:
            financial_defaults = lease_financials_from_lines(fee_lines)

    explicit_values = [
        payload.monthly_rent,
        payload.service_fee_flat,
        payload.security_deposit,
        payload.guarantee_option_fee,
        payload.tax_iva,
    ]
    use_explicit = any(value > 0 for value in explicit_values)

    monthly_rent = payload.monthly_rent if use_explicit else financial_defaults["monthly_rent"]
    service_fee_flat = payload.service_fee_flat if use_explicit else financial_defaults["service_fee_flat"]
    security_deposit = payload.security_deposit if use_explicit else financial_defaults["security_deposit"]
    guarantee_option_fee = payload.guarantee_option_fee if use_explicit else financial_defaults["guarantee_option_fee"]
    tax_iva = payload.tax_iva if use_explicit else financial_defaults["tax_iva"]

    if use_explicit:
        total_move_in = round(monthly_rent + service_fee_flat + security_deposit + guarantee_option_fee + tax_iva, 2)
        monthly_recurring_total = round(monthly_rent + tax_iva, 2)
    else:
        total_move_in = round(float(financial_defaults["total_move_in"]), 2)
        monthly_recurring_total = round(float(financial_defaults["monthly_recurring_total"]), 2)

    lease_payload = {
        "organization_id": org_id,
        "application_id": application_id,
        "property_id": listing.get("property_id") if isinstance(listing, dict) else None,
        "unit_id": listing.get("unit_id") if isinstance(listing, dict) else None,
        "tenant_full_name": application.get("full_name"),
        "tenant_email": application.get("email"),
        "tenant_phone_e164": application.get("phone_e164"),
        "lease_status": "active",
        "starts_on": payload.starts_on,
        "ends_on": payload.ends_on,
        "currency": payload.currency,
        "monthly_rent": monthly_rent,
        "service_fee_flat": service_fee_flat,
        "security_deposit": security_deposit,
        "guarantee_option_fee": guarantee_option_fee,
        "tax_iva": tax_iva,
        "total_move_in": total_move_in,
        "monthly_recurring_total": monthly_recurring_total,
        "platform_fee": payload.platform_fee,
        "notes": payload.notes,
        "created_by_user_id": user_id,
    }

    lease = create_row("leases", lease_payload)

    charge = create_row(
        "lease_charges",
        {
            "organization_id": org_id,
            "lease_id": lease.get("id"),
            "charge_date": payload.starts_on,
            "charge_type": "monthly_rent",
            "description": "First recurring lease charge",
            "amount": monthly_recurring_total,
            "currency": payload.currency,
            "status": "scheduled",
        },
    )

    first_collection = None
    if payload.generate_first_collection:
        due_date = payload.first_collection_due_date or payload.starts_on
        first_collection = create_row(
            "collection_records",
            {
                "organization_id": org_id,
                "lease_id": lease.get("id"),
                "lease_charge_id": charge.get("id"),
                "due_date": due_date,
                "amount": monthly_recurring_total,
                "currency": payload.currency,
                "status": "scheduled",
                "created_by_user_id": user_id,
            },
        )

    updated_application = update_row(
        "application_submissions",
        application_id,
        {
            "status": "contract_signed",
            "qualified_at": application.get("qualified_at")
            or datetime.now(timezone.utc).isoformat(),
            "first_response_at": application.get("first_response_at")
            or datetime.now(timezone.utc).isoformat(),
        },
    )

    create_row(
        "application_events",
        {
            "organization_id": org_id,
            "application_id": application_id,
            "event_type": "lease_sign",
            "event_payload": {
                "lease_id": lease.get("id"),
                "collection_id": first_collection.get("id") if first_collection else None,
            },
            "actor_user_id": user_id,
        },
    )

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="convert_to_lease",
        entity_name="application_submissions",
        entity_id=application_id,
        before_state=application,
        after_state=updated_application,
    )

    write_analytics_event(
        organization_id=org_id,
        event_type="lease_sign",
        payload={
            "application_id": application_id,
            "lease_id": lease.get("id"),
            "collection_id": first_collection.get("id") if first_collection else None,
        },
    )

    return {
        "application": _enrich([updated_application])[0],
        "lease": lease,
        "first_collection": first_collection,
    }
