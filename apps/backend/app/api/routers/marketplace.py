from datetime import datetime, timezone
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.auth import require_user_id
from app.core.config import settings
from app.core.feature_flags import ensure_marketplace_public_enabled
from app.core.tenancy import assert_org_member, assert_org_role
from app.db.supabase import get_supabase_client
from app.schemas.domain import (
    CreateMarketplaceListingInput,
    PublicMarketplaceApplicationInput,
    UpdateMarketplaceListingInput,
)
from app.services.analytics import write_analytics_event
from app.services.alerting import write_alert_event
from app.services.audit import write_audit_log
from app.services.pricing import (
    compute_pricing_totals,
    missing_required_fee_types,
    normalize_fee_lines,
)
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Marketplace"])

MARKETPLACE_EDIT_ROLES = {"owner_admin", "operator"}
MAX_GALLERY_IMAGES = 8


def _normalize_whatsapp_phone(value: Optional[str]) -> Optional[str]:
    if not value or not isinstance(value, str):
        return None
    digits = "".join(char for char in value if char.isdigit())
    return digits or None


def _whatsapp_contact_url() -> Optional[str]:
    normalized = _normalize_whatsapp_phone(settings.marketplace_whatsapp_phone_e164)
    if not normalized:
        return None
    return f"https://wa.me/{normalized}"


def _normalize_gallery_urls(value: object, *, strict: bool) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        if strict:
            raise HTTPException(status_code=400, detail="gallery_image_urls must be an array.")
        return []

    cleaned: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        candidate = item.strip()
        if not candidate:
            continue
        cleaned.append(candidate)

    if len(cleaned) > MAX_GALLERY_IMAGES:
        if not strict:
            return cleaned[:MAX_GALLERY_IMAGES]
        raise HTTPException(
            status_code=400,
            detail=f"gallery_image_urls supports up to {MAX_GALLERY_IMAGES} items.",
        )
    return cleaned


def _sanitize_listing_payload(patch: dict, *, require_cover: bool) -> dict:
    normalized = dict(patch)

    if "gallery_image_urls" in normalized:
        gallery_urls = _normalize_gallery_urls(
            normalized.get("gallery_image_urls"),
            strict=True,
        )
        normalized["gallery_image_urls"] = gallery_urls

    cover_image = normalized.get("cover_image_url")
    if isinstance(cover_image, str):
        normalized["cover_image_url"] = cover_image.strip() or None

    if require_cover and not normalized.get("cover_image_url"):
        raise HTTPException(
            status_code=400,
            detail="cover_image_url is required before publishing marketplace listings.",
        )
    return normalized


def _replace_fee_lines(org_id: str, marketplace_listing_id: str, lines: list[dict]) -> list[dict]:
    client = get_supabase_client()
    client.table("marketplace_listing_fee_lines").delete().eq("marketplace_listing_id", marketplace_listing_id).execute()

    normalized = normalize_fee_lines(lines)
    payload: list[dict] = []
    for index, line in enumerate(normalized, start=1):
        payload.append(
            {
                "organization_id": org_id,
                "marketplace_listing_id": marketplace_listing_id,
                "fee_type": line["fee_type"],
                "label": line["label"],
                "amount": line["amount"],
                "is_refundable": bool(line.get("is_refundable")),
                "is_recurring": bool(line.get("is_recurring")),
                "sort_order": index,
            }
        )

    if payload:
        response = client.table("marketplace_listing_fee_lines").insert(payload).execute()
        return response.data or []

    return []


def _template_lines(org_id: str, template_id: str) -> list[dict]:
    rows = list_rows(
        "pricing_template_lines",
        {
            "organization_id": org_id,
            "pricing_template_id": template_id,
        },
        limit=200,
        order_by="sort_order",
        ascending=True,
    )

    return [
        {
            "fee_type": row.get("fee_type"),
            "label": row.get("label"),
            "amount": row.get("amount"),
            "is_refundable": row.get("is_refundable"),
            "is_recurring": row.get("is_recurring"),
            "sort_order": row.get("sort_order"),
        }
        for row in rows
    ]


def _sync_linked_listing(row: dict, is_publish_state: bool) -> None:
    listing_id = row.get("listing_id")
    if not isinstance(listing_id, str) or not listing_id:
        return

    patch = {
        "marketplace_publishable": bool(is_publish_state),
        "public_slug": row.get("public_slug"),
    }
    try:
        update_row("listings", listing_id, patch)
    except Exception:
        return


def _attach_fee_lines(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    row_ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    if not row_ids:
        return rows

    fee_lines = list_rows(
        "marketplace_listing_fee_lines",
        {"marketplace_listing_id": row_ids},
        limit=max(200, len(row_ids) * 20),
        order_by="sort_order",
        ascending=True,
    )

    grouped: dict[str, list[dict]] = {}
    for line in fee_lines:
        key = str(line.get("marketplace_listing_id") or "")
        grouped.setdefault(key, []).append(line)

    unit_ids = [str(row.get("unit_id") or "") for row in rows if row.get("unit_id")]
    property_ids = [str(row.get("property_id") or "") for row in rows if row.get("property_id")]

    unit_name: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"id": unit_ids}, limit=max(200, len(unit_ids)))
        for unit in units:
            unit_id = unit.get("id")
            if isinstance(unit_id, str):
                unit_name[unit_id] = str(unit.get("name") or "")

    property_name: dict[str, str] = {}
    if property_ids:
        properties = list_rows("properties", {"id": property_ids}, limit=max(200, len(property_ids)))
        for prop in properties:
            prop_id = prop.get("id")
            if isinstance(prop_id, str):
                property_name[prop_id] = str(prop.get("name") or "")

    for row in rows:
        listing_id = str(row.get("id") or "")
        lines = grouped.get(listing_id, [])
        totals = compute_pricing_totals(lines)
        missing = missing_required_fee_types(lines)

        row["fee_lines"] = lines
        row["total_move_in"] = totals["total_move_in"]
        row["monthly_recurring_total"] = totals["monthly_recurring_total"]
        row["fee_breakdown_complete"] = len(missing) == 0
        row["missing_required_fee_lines"] = missing

        pid = row.get("property_id")
        uid = row.get("unit_id")
        if isinstance(pid, str):
            row["property_name"] = property_name.get(pid)
        if isinstance(uid, str):
            row["unit_name"] = unit_name.get(uid)

    return rows


def _assert_publishable(row: dict) -> None:
    row_id = str(row.get("id") or "")
    if not row_id:
        raise HTTPException(status_code=400, detail="Invalid marketplace listing id.")

    _sanitize_listing_payload(row, require_cover=True)

    if not settings.transparent_pricing_required:
        return

    lines = list_rows(
        "marketplace_listing_fee_lines",
        {"marketplace_listing_id": row_id},
        limit=300,
        order_by="sort_order",
        ascending=True,
    )
    missing = missing_required_fee_types(lines)
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Listing cannot be published without a full transparent fee breakdown.",
                "missing_required_fee_lines": missing,
            },
        )


@router.get("/marketplace/listings")
def list_marketplace_listings(
    org_id: str = Query(...),
    is_published: Optional[bool] = Query(None),
    listing_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    filters = {"organization_id": org_id}
    if is_published is not None:
        filters["is_published"] = is_published
    if listing_id:
        filters["listing_id"] = listing_id

    rows = list_rows("marketplace_listings", filters, limit=limit)
    return {"data": _attach_fee_lines(rows)}


@router.post("/marketplace/listings", status_code=201)
def create_marketplace_listing(
    payload: CreateMarketplaceListingInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_role(user_id, payload.organization_id, MARKETPLACE_EDIT_ROLES)

    listing_payload = payload.model_dump(exclude={"fee_lines"}, exclude_none=True)
    listing_payload = _sanitize_listing_payload(listing_payload, require_cover=False)
    listing_payload["created_by_user_id"] = user_id

    if listing_payload.get("listing_id"):
        listing = get_row("listings", listing_payload["listing_id"])
        if listing.get("organization_id") != payload.organization_id:
            raise HTTPException(status_code=400, detail="listing_id does not belong to this organization.")

    if listing_payload.get("unit_id"):
        unit = get_row("units", listing_payload["unit_id"])
        if unit.get("organization_id") != payload.organization_id:
            raise HTTPException(status_code=400, detail="unit_id does not belong to this organization.")
        if not listing_payload.get("property_id") and isinstance(unit.get("property_id"), str):
            listing_payload["property_id"] = unit.get("property_id")
        if listing_payload.get("bedrooms") is None:
            listing_payload["bedrooms"] = unit.get("bedrooms")
        if listing_payload.get("bathrooms") is None:
            listing_payload["bathrooms"] = unit.get("bathrooms")
        if listing_payload.get("square_meters") is None:
            listing_payload["square_meters"] = unit.get("square_meters")

    if listing_payload.get("property_id"):
        prop = get_row("properties", listing_payload["property_id"])
        if prop.get("organization_id") != payload.organization_id:
            raise HTTPException(status_code=400, detail="property_id does not belong to this organization.")

    created = create_row("marketplace_listings", listing_payload)
    marketplace_listing_id = str(created.get("id") or "")

    source_lines = [line.model_dump(exclude_none=True) for line in payload.fee_lines]
    if not source_lines and payload.pricing_template_id:
        source_lines = _template_lines(payload.organization_id, payload.pricing_template_id)
    created_lines = _replace_fee_lines(payload.organization_id, marketplace_listing_id, source_lines)

    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="marketplace_listings",
        entity_id=marketplace_listing_id,
        before_state=None,
        after_state={**created, "fee_lines": created_lines},
    )

    rows = _attach_fee_lines([created])
    return rows[0] if rows else created


@router.get("/marketplace/listings/{marketplace_listing_id}")
def get_marketplace_listing(
    marketplace_listing_id: str,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("marketplace_listings", marketplace_listing_id)
    assert_org_member(user_id, record["organization_id"])

    rows = _attach_fee_lines([record])
    return rows[0] if rows else record


@router.patch("/marketplace/listings/{marketplace_listing_id}")
def update_marketplace_listing(
    marketplace_listing_id: str,
    payload: UpdateMarketplaceListingInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("marketplace_listings", marketplace_listing_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, MARKETPLACE_EDIT_ROLES)

    patch = payload.model_dump(exclude_none=True, exclude={"fee_lines"})
    patch = _sanitize_listing_payload(patch, require_cover=False)

    if patch.get("listing_id"):
        listing = get_row("listings", patch["listing_id"])
        if listing.get("organization_id") != org_id:
            raise HTTPException(status_code=400, detail="listing_id does not belong to this organization.")

    if patch.get("unit_id"):
        unit = get_row("units", patch["unit_id"])
        if unit.get("organization_id") != org_id:
            raise HTTPException(status_code=400, detail="unit_id does not belong to this organization.")
        if not patch.get("property_id") and isinstance(unit.get("property_id"), str):
            patch["property_id"] = unit.get("property_id")
        if "bedrooms" not in patch:
            patch["bedrooms"] = unit.get("bedrooms")
        if "bathrooms" not in patch:
            patch["bathrooms"] = unit.get("bathrooms")
        if "square_meters" not in patch:
            patch["square_meters"] = unit.get("square_meters")

    if patch.get("property_id"):
        prop = get_row("properties", patch["property_id"])
        if prop.get("organization_id") != org_id:
            raise HTTPException(status_code=400, detail="property_id does not belong to this organization.")

    updated = record
    if patch:
        updated = update_row("marketplace_listings", marketplace_listing_id, patch)

    if payload.fee_lines is not None:
        lines = [line.model_dump(exclude_none=True) for line in payload.fee_lines]
        _replace_fee_lines(org_id, marketplace_listing_id, lines)

    if payload.is_published:
        _assert_publishable(updated)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="update",
        entity_name="marketplace_listings",
        entity_id=marketplace_listing_id,
        before_state=record,
        after_state=updated,
    )

    if bool(updated.get("is_published")):
        _sync_linked_listing(updated, is_publish_state=True)

    rows = _attach_fee_lines([updated])
    return rows[0] if rows else updated


@router.post("/marketplace/listings/{marketplace_listing_id}/publish")
def publish_marketplace_listing(
    marketplace_listing_id: str,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("marketplace_listings", marketplace_listing_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, MARKETPLACE_EDIT_ROLES)

    _assert_publishable(record)

    patch = {
        "is_published": True,
        "published_at": datetime.now(timezone.utc).isoformat(),
    }
    updated = update_row("marketplace_listings", marketplace_listing_id, patch)
    _sync_linked_listing(updated, is_publish_state=True)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="status_transition",
        entity_name="marketplace_listings",
        entity_id=marketplace_listing_id,
        before_state=record,
        after_state=updated,
    )

    rows = _attach_fee_lines([updated])
    return rows[0] if rows else updated


def _public_shape(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "organization_id": row.get("organization_id"),
        "public_slug": row.get("public_slug"),
        "title": row.get("title"),
        "summary": row.get("summary"),
        "description": row.get("description"),
        "city": row.get("city"),
        "neighborhood": row.get("neighborhood"),
        "country_code": row.get("country_code"),
        "currency": row.get("currency"),
        "application_url": row.get("application_url"),
        "cover_image_url": row.get("cover_image_url"),
        "gallery_image_urls": _normalize_gallery_urls(
            row.get("gallery_image_urls"),
            strict=False,
        ),
        "bedrooms": row.get("bedrooms"),
        "bathrooms": row.get("bathrooms"),
        "square_meters": row.get("square_meters"),
        "whatsapp_contact_url": _whatsapp_contact_url(),
        "published_at": row.get("published_at"),
        "total_move_in": row.get("total_move_in"),
        "monthly_recurring_total": row.get("monthly_recurring_total"),
        "fee_lines": row.get("fee_lines") or [],
        "fee_breakdown_complete": bool(row.get("fee_breakdown_complete")),
        "missing_required_fee_lines": row.get("missing_required_fee_lines") or [],
    }


@router.get("/public/marketplace/listings")
def list_public_marketplace_listings(
    city: Annotated[Optional[str], Query(max_length=120)] = None,
    neighborhood: Annotated[Optional[str], Query(max_length=120)] = None,
    q: Annotated[Optional[str], Query(max_length=200)] = None,
    min_monthly: Annotated[Optional[float], Query(ge=0)] = None,
    max_monthly: Annotated[Optional[float], Query(ge=0)] = None,
    min_move_in: Annotated[Optional[float], Query(ge=0)] = None,
    max_move_in: Annotated[Optional[float], Query(ge=0)] = None,
    min_bedrooms: Annotated[Optional[int], Query(ge=0)] = None,
    min_bathrooms: Annotated[Optional[float], Query(ge=0)] = None,
    org_id: Annotated[Optional[str], Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> dict:
    ensure_marketplace_public_enabled()

    filters: dict[str, object] = {"is_published": True}
    if org_id:
        filters["organization_id"] = org_id

    rows = list_rows(
        "marketplace_listings",
        filters,
        limit=limit,
        order_by="published_at",
        ascending=False,
    )
    rows = _attach_fee_lines(rows)

    if city:
        expected = city.strip().lower()
        rows = [row for row in rows if str(row.get("city") or "").strip().lower() == expected]

    if neighborhood:
        expected = neighborhood.strip().lower()
        rows = [
            row
            for row in rows
            if expected in str(row.get("neighborhood") or "").strip().lower()
        ]

    if q:
        needle = q.strip().lower()
        rows = [
            row
            for row in rows
            if needle in str(row.get("title") or "").lower()
            or needle in str(row.get("summary") or "").lower()
            or needle in str(row.get("neighborhood") or "").lower()
            or needle in str(row.get("description") or "").lower()
        ]

    if min_monthly is not None:
        rows = [row for row in rows if float(row.get("monthly_recurring_total", 0) or 0) >= min_monthly]

    if max_monthly is not None:
        rows = [row for row in rows if float(row.get("monthly_recurring_total", 0) or 0) <= max_monthly]

    if min_move_in is not None:
        rows = [row for row in rows if float(row.get("total_move_in", 0) or 0) >= min_move_in]

    if max_move_in is not None:
        rows = [row for row in rows if float(row.get("total_move_in", 0) or 0) <= max_move_in]

    if min_bedrooms is not None:
        rows = [row for row in rows if int(row.get("bedrooms", 0) or 0) >= min_bedrooms]

    if min_bathrooms is not None:
        rows = [row for row in rows if float(row.get("bathrooms", 0) or 0) >= min_bathrooms]

    shaped = [_public_shape(row) for row in rows]
    return {"data": shaped}


@router.get("/public/marketplace/listings/{slug}")
def get_public_marketplace_listing(slug: str) -> dict:
    ensure_marketplace_public_enabled()

    rows = list_rows(
        "marketplace_listings",
        {"public_slug": slug, "is_published": True},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Public marketplace listing not found.")

    shaped = _public_shape(_attach_fee_lines(rows)[0])
    write_analytics_event(
        organization_id=str(shaped.get("organization_id") or ""),
        event_type="view",
        payload={"listing_slug": slug, "marketplace_listing_id": shaped.get("id")},
    )
    return shaped


@router.post("/public/marketplace/listings/{slug}/apply-start")
def start_public_marketplace_application(slug: str) -> dict:
    ensure_marketplace_public_enabled()

    rows = list_rows(
        "marketplace_listings",
        {"public_slug": slug, "is_published": True},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Public marketplace listing not found.")

    listing = rows[0]
    write_analytics_event(
        organization_id=listing.get("organization_id"),
        event_type="apply_start",
        payload={"listing_slug": slug, "marketplace_listing_id": listing.get("id")},
    )
    return {"ok": True}


@router.post("/public/marketplace/listings/{slug}/contact-whatsapp")
def track_public_marketplace_whatsapp_contact(slug: str) -> dict:
    ensure_marketplace_public_enabled()

    rows = list_rows(
        "marketplace_listings",
        {"public_slug": slug, "is_published": True},
        limit=1,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Public marketplace listing not found.")

    listing = rows[0]
    write_analytics_event(
        organization_id=listing.get("organization_id"),
        event_type="contact_whatsapp",
        payload={"listing_slug": slug, "marketplace_listing_id": listing.get("id")},
    )
    return {"ok": True, "whatsapp_contact_url": _whatsapp_contact_url()}


@router.post("/public/marketplace/applications", status_code=201)
def submit_public_marketplace_application(payload: PublicMarketplaceApplicationInput) -> dict:
    ensure_marketplace_public_enabled()

    listing: Optional[dict] = None

    if payload.marketplace_listing_id:
        listing = get_row("marketplace_listings", payload.marketplace_listing_id)
    elif payload.listing_slug:
        rows = list_rows(
            "marketplace_listings",
            {"public_slug": payload.listing_slug},
            limit=1,
        )
        listing = rows[0] if rows else None

    if not listing:
        raise HTTPException(status_code=400, detail="marketplace_listing_id or listing_slug is required.")

    if not listing.get("is_published"):
        raise HTTPException(status_code=400, detail="Listing is not published.")

    org_id = str(listing.get("organization_id") or "")
    if not org_id:
        raise HTTPException(status_code=400, detail="Listing is missing organization context.")

    application_payload = payload.model_dump(exclude_none=True)
    application_payload["organization_id"] = org_id
    application_payload["marketplace_listing_id"] = listing.get("id")

    if not application_payload.get("listing_slug") and listing.get("public_slug"):
        application_payload["listing_slug"] = listing.get("public_slug")

    application_payload.pop("org_id", None)
    application_payload.pop("listing_slug", None)

    alert_payload = {
        "stage": "application_submission",
        "marketplace_listing_id": listing.get("id"),
        "listing_slug": listing.get("public_slug"),
        "source": application_payload.get("source"),
    }

    try:
        created = create_row("application_submissions", application_payload)
    except HTTPException as exc:
        write_alert_event(
            organization_id=org_id,
            event_type="application_submit_failed",
            payload={
                **alert_payload,
                "status_code": exc.status_code,
            },
            severity="error",
            error_message=str(exc.detail),
        )
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        write_alert_event(
            organization_id=org_id,
            event_type="application_submit_failed",
            payload=alert_payload,
            severity="error",
            error_message=str(exc),
        )
        raise

    try:
        create_row(
            "application_events",
            {
                "organization_id": org_id,
                "application_id": created.get("id"),
                "event_type": "apply_submit",
                "event_payload": {
                    "marketplace_listing_id": listing.get("id"),
                    "listing_slug": listing.get("public_slug"),
                    "source": created.get("source"),
                },
            },
        )
    except Exception as exc:
        write_alert_event(
            organization_id=org_id,
            event_type="application_event_write_failed",
            payload={
                "stage": "application_event_write",
                "marketplace_listing_id": listing.get("id"),
                "listing_slug": listing.get("public_slug"),
                "application_id": created.get("id"),
            },
            severity="warning",
            error_message=str(exc),
        )

    write_analytics_event(
        organization_id=org_id,
        event_type="apply_submit",
        payload={
            "marketplace_listing_id": listing.get("id"),
            "listing_slug": listing.get("public_slug"),
            "application_id": created.get("id"),
        },
    )

    return {
        "id": created.get("id"),
        "status": created.get("status"),
        "marketplace_listing_id": created.get("marketplace_listing_id"),
    }
