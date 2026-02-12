from fastapi import APIRouter, Depends, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.db.supabase import get_supabase_client
from app.schemas.domain import CreatePricingTemplateInput, UpdatePricingTemplateInput
from app.services.audit import write_audit_log
from app.services.pricing import compute_pricing_totals, normalize_fee_lines
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Pricing"])


PRICING_EDIT_ROLES = {"owner_admin", "operator", "accountant"}


def _replace_template_lines(org_id: str, template_id: str, lines: list[dict]) -> list[dict]:
    client = get_supabase_client()
    client.table("pricing_template_lines").delete().eq("pricing_template_id", template_id).execute()

    normalized = normalize_fee_lines(lines)
    payload: list[dict] = []
    for index, line in enumerate(normalized, start=1):
        payload.append(
            {
                "organization_id": org_id,
                "pricing_template_id": template_id,
                "fee_type": line["fee_type"],
                "label": line["label"],
                "amount": line["amount"],
                "is_refundable": bool(line.get("is_refundable")),
                "is_recurring": bool(line.get("is_recurring")),
                "sort_order": index,
            }
        )

    if payload:
        response = client.table("pricing_template_lines").insert(payload).execute()
        return response.data or []

    return []


def _attach_lines(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows

    template_ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    if not template_ids:
        return rows

    lines = list_rows(
        "pricing_template_lines",
        {"pricing_template_id": template_ids},
        limit=max(200, len(template_ids) * 20),
        order_by="sort_order",
        ascending=True,
    )

    grouped: dict[str, list[dict]] = {}
    for line in lines:
        key = str(line.get("pricing_template_id") or "")
        grouped.setdefault(key, []).append(line)

    for row in rows:
        row_id = str(row.get("id") or "")
        fee_lines = grouped.get(row_id, [])
        totals = compute_pricing_totals(fee_lines)
        row["lines"] = fee_lines
        row["total_move_in"] = totals["total_move_in"]
        row["monthly_recurring_total"] = totals["monthly_recurring_total"]

    return rows


def _set_default_template(org_id: str, template_id: str) -> None:
    client = get_supabase_client()
    client.table("pricing_templates").update({"is_default": False}).eq("organization_id", org_id).neq("id", template_id).execute()


@router.get("/pricing/templates")
def list_pricing_templates(
    org_id: str = Query(...),
    is_active: Optional[bool] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)
    filters = {"organization_id": org_id}
    if is_active is not None:
        filters["is_active"] = is_active

    rows = list_rows("pricing_templates", filters, limit=limit)
    return {"data": _attach_lines(rows)}


@router.post("/pricing/templates", status_code=201)
def create_pricing_template(payload: CreatePricingTemplateInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, PRICING_EDIT_ROLES)

    template_payload = payload.model_dump(exclude={"lines"}, exclude_none=True)
    template_payload["created_by_user_id"] = user_id

    created = create_row("pricing_templates", template_payload)
    template_id = str(created.get("id") or "")

    line_payload = [line.model_dump(exclude_none=True) for line in payload.lines]
    created_lines = _replace_template_lines(payload.organization_id, template_id, line_payload)

    if payload.is_default:
        _set_default_template(payload.organization_id, template_id)

    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="pricing_templates",
        entity_id=created.get("id"),
        before_state=None,
        after_state={**created, "lines": created_lines},
    )

    rows = _attach_lines([created])
    return rows[0] if rows else created


@router.get("/pricing/templates/{template_id}")
def get_pricing_template(template_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("pricing_templates", template_id)
    assert_org_member(user_id, record["organization_id"])

    rows = _attach_lines([record])
    return rows[0] if rows else record


@router.patch("/pricing/templates/{template_id}")
def update_pricing_template(
    template_id: str,
    payload: UpdatePricingTemplateInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    record = get_row("pricing_templates", template_id)
    org_id = str(record.get("organization_id") or "")
    assert_org_role(user_id, org_id, PRICING_EDIT_ROLES)

    patch = payload.model_dump(exclude_none=True, exclude={"lines"})
    updated = record

    if patch:
        updated = update_row("pricing_templates", template_id, patch)

    if payload.lines is not None:
        line_payload = [line.model_dump(exclude_none=True) for line in payload.lines]
        _replace_template_lines(org_id, template_id, line_payload)

    if payload.is_default:
        _set_default_template(org_id, template_id)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="update",
        entity_name="pricing_templates",
        entity_id=template_id,
        before_state=record,
        after_state=updated,
    )

    rows = _attach_lines([updated])
    return rows[0] if rows else updated
