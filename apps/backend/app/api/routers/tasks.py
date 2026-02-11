from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import (
    CompleteTaskInput,
    CreateTaskInput,
    CreateTaskItemInput,
    UpdateTaskInput,
    UpdateTaskItemInput,
)
from app.services.audit import write_audit_log
from app.services.enrichment import enrich_tasks
from app.services.table_service import create_row, delete_row, get_row, list_rows, update_row

router = APIRouter(tags=["Tasks"])

TASK_ITEM_UPDATE_ROLES = {"owner_admin", "operator", "cleaner"}
TASK_ITEM_MANAGE_ROLES = {"owner_admin", "operator"}


def _parse_iso_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
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


def _flag_sla_breach(task: dict) -> dict:
    status = str(task.get("status") or "")
    if status in {"done", "cancelled"}:
        return task
    if task.get("sla_breached_at"):
        return task

    sla_due_at = _parse_iso_datetime(task.get("sla_due_at"))
    if not sla_due_at:
        return task

    if sla_due_at <= datetime.now(timezone.utc):
        try:
            updated = update_row(
                "tasks",
                str(task.get("id") or ""),
                {"sla_breached_at": datetime.now(timezone.utc).isoformat()},
            )
            return updated
        except Exception:
            return task

    return task


def _get_task(task_id: str) -> dict:
    record = get_row("tasks", task_id)
    if not record.get("organization_id"):
        raise HTTPException(status_code=500, detail="Task is missing organization_id.")
    return record


def _next_sort_order(task_id: str) -> int:
    rows = list_rows(
        "task_items",
        {"task_id": task_id},
        limit=1,
        order_by="sort_order",
        ascending=False,
    )
    if not rows:
        return 1

    raw = rows[0].get("sort_order")
    try:
        value = int(raw)
    except Exception:
        value = 0
    return max(0, value) + 1


@router.get("/tasks")
def list_tasks(
    org_id: str = Query(...),
    status: Optional[str] = Query(None),
    assigned_user_id: Optional[str] = Query(None),
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    reservation_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)
    filters = {"organization_id": org_id}
    if status:
        filters["status"] = status
    if assigned_user_id:
        filters["assigned_user_id"] = assigned_user_id
    if property_id:
        filters["property_id"] = property_id
    if unit_id:
        filters["unit_id"] = unit_id
    if reservation_id:
        filters["reservation_id"] = reservation_id
    rows = [_flag_sla_breach(item) for item in list_rows("tasks", filters, limit=limit)]
    return {"data": enrich_tasks(rows, org_id)}


@router.post("/tasks", status_code=201)
def create_task(payload: CreateTaskInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, {"owner_admin", "operator"})
    created = create_row("tasks", payload.model_dump(exclude_none=True))
    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="tasks",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )
    return created


@router.get("/tasks/{task_id}")
def get_task(task_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = _get_task(task_id)
    assert_org_member(user_id, record["organization_id"])
    return enrich_tasks([_flag_sla_breach(record)], record["organization_id"])[0]


@router.patch("/tasks/{task_id}")
def update_task(task_id: str, payload: UpdateTaskInput, user_id: str = Depends(require_user_id)) -> dict:
    record = _get_task(task_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "operator"})
    updated = update_row("tasks", task_id, payload.model_dump(exclude_none=True))
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="update",
        entity_name="tasks",
        entity_id=task_id,
        before_state=record,
        after_state=updated,
    )
    return updated


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: str, payload: Optional[CompleteTaskInput] = None, user_id: str = Depends(require_user_id)) -> dict:
    record = _get_task(task_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "operator", "cleaner"})

    # Prevent marking the task as done while required checklist items are still open.
    missing_required = list_rows(
        "task_items",
        {"task_id": task_id, "is_required": True, "is_completed": False},
        limit=2000,
        order_by="sort_order",
        ascending=True,
    )
    if missing_required:
        labels = [
            str(row.get("label") or "").strip()
            for row in missing_required
            if str(row.get("label") or "").strip()
        ]
        preview = ", ".join(labels[:5])
        suffix = f" Missing: {preview}" if preview else ""
        if len(labels) > 5:
            suffix = f"{suffix} (+{len(labels) - 5} more)" if suffix else f" (+{len(labels) - 5} more)"
        raise HTTPException(
            status_code=400,
            detail=f"Complete required checklist items before completing this task.{suffix}",
        )

    patch = {
        "status": "done",
        "completed_at": datetime.now(timezone.utc).isoformat(),
        "completion_notes": payload.completion_notes if payload else None,
    }
    updated = update_row("tasks", task_id, patch)
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="complete",
        entity_name="tasks",
        entity_id=task_id,
        before_state=record,
        after_state=updated,
    )
    return updated


@router.get("/tasks/{task_id}/items")
def list_task_items(
    task_id: str,
    limit: int = Query(200, ge=1, le=2000),
    user_id: str = Depends(require_user_id),
) -> dict:
    task = _get_task(task_id)
    assert_org_member(user_id, task["organization_id"])

    rows = list_rows(
        "task_items",
        {"task_id": task_id},
        limit=limit,
        order_by="sort_order",
        ascending=True,
    )
    return {"data": rows}


@router.post("/tasks/{task_id}/items", status_code=201)
def create_task_item(
    task_id: str,
    payload: CreateTaskItemInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    task = _get_task(task_id)
    assert_org_role(user_id, task["organization_id"], TASK_ITEM_MANAGE_ROLES)

    label = payload.label.strip() if isinstance(payload.label, str) else ""
    if not label:
        raise HTTPException(status_code=400, detail="label is required.")

    sort_order = payload.sort_order
    if sort_order is None:
        sort_order = _next_sort_order(task_id)
    elif sort_order <= 0:
        raise HTTPException(status_code=400, detail="sort_order must be greater than 0.")

    record = {
        "task_id": task_id,
        "sort_order": sort_order,
        "label": label,
        "is_required": bool(payload.is_required),
        "is_completed": False,
    }

    created = create_row("task_items", record)
    write_audit_log(
        organization_id=task.get("organization_id"),
        actor_user_id=user_id,
        action="create",
        entity_name="task_items",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )
    return created


@router.patch("/tasks/{task_id}/items/{item_id}")
def update_task_item(
    task_id: str,
    item_id: str,
    payload: UpdateTaskItemInput,
    user_id: str = Depends(require_user_id),
) -> dict:
    task = _get_task(task_id)
    assert_org_role(user_id, task["organization_id"], TASK_ITEM_UPDATE_ROLES)

    existing = get_row("task_items", item_id)
    if existing.get("task_id") != task_id:
        raise HTTPException(status_code=404, detail="task_items record not found.")

    patch = payload.model_dump(exclude_none=True)

    if "label" in patch:
        next_label = str(patch.get("label") or "").strip()
        if not next_label:
            raise HTTPException(status_code=400, detail="label cannot be empty.")
        patch["label"] = next_label

    if "sort_order" in patch:
        try:
            value = int(patch.get("sort_order"))
        except Exception:
            raise HTTPException(status_code=400, detail="sort_order must be an integer.")
        if value <= 0:
            raise HTTPException(status_code=400, detail="sort_order must be greater than 0.")
        patch["sort_order"] = value

    updated = update_row("task_items", item_id, patch)
    write_audit_log(
        organization_id=task.get("organization_id"),
        actor_user_id=user_id,
        action="update",
        entity_name="task_items",
        entity_id=item_id,
        before_state=existing,
        after_state=updated,
    )
    return updated


@router.delete("/tasks/{task_id}/items/{item_id}")
def delete_task_item(task_id: str, item_id: str, user_id: str = Depends(require_user_id)) -> dict:
    task = _get_task(task_id)
    assert_org_role(user_id, task["organization_id"], TASK_ITEM_MANAGE_ROLES)

    existing = get_row("task_items", item_id)
    if existing.get("task_id") != task_id:
        raise HTTPException(status_code=404, detail="task_items record not found.")

    deleted = delete_row("task_items", item_id)
    write_audit_log(
        organization_id=task.get("organization_id"),
        actor_user_id=user_id,
        action="delete",
        entity_name="task_items",
        entity_id=item_id,
        before_state=deleted,
        after_state=None,
    )
    return deleted
