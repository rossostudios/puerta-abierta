from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member, assert_org_role
from app.schemas.domain import CreateReservationInput, ReservationStatusInput, UpdateReservationInput
from app.services.audit import write_audit_log
from app.services.enrichment import enrich_reservations
from app.services.table_service import create_row, get_row, list_rows, update_row

router = APIRouter(tags=["Reservations"])

ACTIVE_BOOKING_STATUSES = {"pending", "confirmed", "checked_in"}
ALLOWED_TRANSITIONS = {
    "pending": {"confirmed", "cancelled"},
    "confirmed": {"checked_in", "cancelled", "no_show"},
    "checked_in": {"checked_out"},
    "checked_out": set(),
    "cancelled": set(),
    "no_show": set(),
}

DEFAULT_ORG_TIMEZONE = "America/Asuncion"
AUTO_TURNOVER_TASK_TYPES = {"check_in", "check_out", "cleaning", "inspection"}
AUTO_CLEANING_CHECKLIST = [
    "Retirar basura y reponer bolsas.",
    "Cambiar sabanas y toallas.",
    "Desinfectar bano y cocina.",
    "Reponer amenities y consumibles.",
    "Registrar fotos del estado final.",
]
AUTO_CHECK_IN_CHECKLIST = [
    "Validar limpieza final y olor del ambiente.",
    "Confirmar acceso (llaves, cerradura o codigo).",
    "Verificar wifi, agua caliente y aire acondicionado.",
    "Enviar instrucciones de llegada al huesped.",
]
AUTO_CHECK_OUT_CHECKLIST = [
    "Confirmar hora estimada de salida.",
    "Solicitar reporte de incidentes del huesped.",
    "Verificar consumos o cargos pendientes.",
]
AUTO_INSPECTION_CHECKLIST = [
    "Inspeccionar danos visibles y faltantes.",
    "Registrar evidencias fotograficas.",
    "Crear ticket de mantenimiento si aplica.",
]
AUTO_TASK_BLUEPRINTS: dict[str, list[dict[str, object]]] = {
    "confirmed": [
        {
            "type": "check_in",
            "title": "Preparar check-in",
            "priority": "high",
            "description": "Checklist operativo previo a la llegada del huesped.",
            "date_field": "check_in_date",
            "time_field": "check_in_time",
            "fallback_time": "15:00:00",
            "checklist": AUTO_CHECK_IN_CHECKLIST,
        }
    ],
    "checked_in": [
        {
            "type": "check_out",
            "title": "Planificar check-out",
            "priority": "medium",
            "description": "Asegurar salida ordenada y preparacion para turnover.",
            "date_field": "check_out_date",
            "time_field": "check_out_time",
            "fallback_time": "11:00:00",
            "checklist": AUTO_CHECK_OUT_CHECKLIST,
        }
    ],
    "checked_out": [
        {
            "type": "cleaning",
            "title": "Turnover: limpieza",
            "priority": "high",
            "description": "Limpieza completa posterior al check-out.",
            "date_field": "check_out_date",
            "time_field": "check_out_time",
            "fallback_time": "11:00:00",
            "checklist": AUTO_CLEANING_CHECKLIST,
        },
        {
            "type": "inspection",
            "title": "Turnover: inspeccion",
            "priority": "high",
            "description": "Inspeccion de danos e inventario post estadia.",
            "date_field": "check_out_date",
            "time_field": "check_out_time",
            "fallback_time": "13:00:00",
            "checklist": AUTO_INSPECTION_CHECKLIST,
        },
    ],
}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _parse_time(value: object, fallback: str) -> time:
    if isinstance(value, str):
        raw = value.strip()
        if raw:
            try:
                return time.fromisoformat(raw)
            except Exception:
                pass
    return time.fromisoformat(fallback)


def _resolve_org_timezone(org_id: str) -> str:
    try:
        organization = get_row("organizations", org_id)
    except Exception:
        return DEFAULT_ORG_TIMEZONE

    timezone_name = organization.get("timezone")
    if isinstance(timezone_name, str) and timezone_name.strip():
        return timezone_name.strip()
    return DEFAULT_ORG_TIMEZONE


def _as_utc_iso(local_date: str, local_time: object, fallback_time: str, timezone_name: str) -> str:
    due_date = _parse_date(local_date)
    due_time = _parse_time(local_time, fallback_time)

    try:
        zone = ZoneInfo(timezone_name)
    except Exception:
        zone = ZoneInfo(DEFAULT_ORG_TIMEZONE)

    local_due = datetime.combine(due_date, due_time, tzinfo=zone)
    return local_due.astimezone(timezone.utc).isoformat()


def _ensure_task_items(task_id: str, checklist: list[str]) -> None:
    if not checklist:
        return

    existing_items = list_rows(
        "task_items",
        {"task_id": task_id},
        limit=1,
        order_by="sort_order",
        ascending=True,
    )
    if existing_items:
        return

    for index, label in enumerate(checklist, start=1):
        create_row(
            "task_items",
            {
                "task_id": task_id,
                "sort_order": index,
                "label": label,
                "is_required": True,
                "is_completed": False,
            },
        )


def _upsert_turnover_task(
    *,
    reservation: dict,
    unit: dict,
    org_timezone: str,
    actor_user_id: str,
    task_type: str,
    title: str,
    description: str,
    priority: str,
    date_field: str,
    time_field: str,
    fallback_time: str,
    checklist: list[str],
) -> None:
    org_id = str(reservation.get("organization_id") or "").strip()
    reservation_id = str(reservation.get("id") or "").strip()
    unit_id = str(reservation.get("unit_id") or "").strip()
    due_date = str(reservation.get(date_field) or "").strip()
    if not all([org_id, reservation_id, unit_id, due_date]):
        return

    due_at = _as_utc_iso(
        local_date=due_date,
        local_time=unit.get(time_field),
        fallback_time=fallback_time,
        timezone_name=org_timezone,
    )

    property_id = unit.get("property_id")
    if not isinstance(property_id, str) or not property_id.strip():
        property_id = None

    existing_tasks = list_rows(
        "tasks",
        {
            "organization_id": org_id,
            "reservation_id": reservation_id,
            "type": task_type,
        },
        limit=20,
        order_by="created_at",
        ascending=False,
    )

    open_task = next(
        (
            row
            for row in existing_tasks
            if str(row.get("status") or "").strip().lower() != "cancelled"
        ),
        None,
    )
    if open_task:
        task_id = str(open_task.get("id") or "").strip()
        if task_id:
            _ensure_task_items(task_id, checklist)
        return

    reusable_cancelled = next(
        (
            row
            for row in existing_tasks
            if str(row.get("status") or "").strip().lower() == "cancelled"
        ),
        None,
    )

    payload = {
        "organization_id": org_id,
        "property_id": property_id,
        "unit_id": unit_id,
        "reservation_id": reservation_id,
        "type": task_type,
        "status": "todo",
        "priority": priority,
        "title": title,
        "description": description,
        "due_at": due_at,
        "sla_due_at": due_at,
        "created_by_user_id": actor_user_id,
    }

    task_id = ""
    if reusable_cancelled:
        reusable_id = str(reusable_cancelled.get("id") or "").strip()
        if reusable_id:
            updated = update_row(
                "tasks",
                reusable_id,
                {
                    "title": title,
                    "description": description,
                    "status": "todo",
                    "priority": priority,
                    "due_at": due_at,
                    "sla_due_at": due_at,
                    "sla_breached_at": None,
                    "completed_at": None,
                    "completion_notes": None,
                },
            )
            task_id = str(updated.get("id") or reusable_id)

    if not task_id:
        created = create_row("tasks", payload)
        task_id = str(created.get("id") or "").strip()

    if task_id:
        _ensure_task_items(task_id, checklist)


def _cancel_open_turnover_tasks(reservation: dict) -> None:
    org_id = str(reservation.get("organization_id") or "").strip()
    reservation_id = str(reservation.get("id") or "").strip()
    if not org_id or not reservation_id:
        return

    existing_tasks = list_rows(
        "tasks",
        {"organization_id": org_id, "reservation_id": reservation_id},
        limit=200,
        order_by="created_at",
        ascending=False,
    )

    for task in existing_tasks:
        task_type = str(task.get("type") or "").strip().lower()
        task_status = str(task.get("status") or "").strip().lower()
        if task_type not in AUTO_TURNOVER_TASK_TYPES:
            continue
        if task_status in {"done", "cancelled"}:
            continue
        task_id = str(task.get("id") or "").strip()
        if not task_id:
            continue
        update_row(
            "tasks",
            task_id,
            {
                "status": "cancelled",
                "completion_notes": "Cancelada automaticamente por cambio de estado de reserva.",
            },
        )


def _sync_turnover_tasks_for_status(reservation: dict, actor_user_id: str) -> None:
    status = str(reservation.get("status") or "").strip().lower()
    if status in {"cancelled", "no_show"}:
        _cancel_open_turnover_tasks(reservation)
        return

    blueprints = AUTO_TASK_BLUEPRINTS.get(status)
    if not blueprints:
        return

    unit_id = str(reservation.get("unit_id") or "").strip()
    org_id = str(reservation.get("organization_id") or "").strip()
    if not unit_id or not org_id:
        return

    unit = get_row("units", unit_id)
    org_timezone = _resolve_org_timezone(org_id)

    for blueprint in blueprints:
        checklist = blueprint.get("checklist")
        _upsert_turnover_task(
            reservation=reservation,
            unit=unit,
            org_timezone=org_timezone,
            actor_user_id=actor_user_id,
            task_type=str(blueprint.get("type") or "custom"),
            title=str(blueprint.get("title") or "Task"),
            description=str(blueprint.get("description") or ""),
            priority=str(blueprint.get("priority") or "medium"),
            date_field=str(blueprint.get("date_field") or "check_out_date"),
            time_field=str(blueprint.get("time_field") or "check_out_time"),
            fallback_time=str(blueprint.get("fallback_time") or "12:00:00"),
            checklist=list(checklist) if isinstance(checklist, list) else [],
        )


def _has_overlap(unit_id: str, check_in_date: str, check_out_date: str, org_id: str) -> bool:
    reservations = list_rows("reservations", {"organization_id": org_id, "unit_id": unit_id}, limit=1000)
    new_start = _parse_date(check_in_date)
    new_end = _parse_date(check_out_date)

    for reservation in reservations:
        if reservation.get("status") not in ACTIVE_BOOKING_STATUSES:
            continue
        existing_start = _parse_date(reservation["check_in_date"])
        existing_end = _parse_date(reservation["check_out_date"])
        if not (new_end <= existing_start or new_start >= existing_end):
            return True
    return False

@router.get("/reservations")
def list_reservations(
    org_id: str = Query(...),
    unit_id: Optional[str] = Query(None),
    listing_id: Optional[str] = Query(None),
    guest_id: Optional[str] = Query(None),
    channel_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)
    filters = {"organization_id": org_id}
    if unit_id:
        filters["unit_id"] = unit_id
    if listing_id:
        filters["listing_id"] = listing_id
    if guest_id:
        filters["guest_id"] = guest_id
    if channel_id:
        filters["channel_id"] = channel_id
    if status:
        filters["status"] = status
    rows = list_rows("reservations", filters, limit=limit, order_by="check_in_date", ascending=True)
    return {"data": enrich_reservations(rows, org_id)}


@router.post("/reservations", status_code=201)
def create_reservation(payload: CreateReservationInput, user_id: str = Depends(require_user_id)) -> dict:
    assert_org_role(user_id, payload.organization_id, {"owner_admin", "operator"})
    if _has_overlap(
        unit_id=payload.unit_id,
        check_in_date=payload.check_in_date,
        check_out_date=payload.check_out_date,
        org_id=payload.organization_id,
    ):
        raise HTTPException(status_code=409, detail="Reservation overlaps an existing active reservation.")
    created = create_row("reservations", payload.model_dump(exclude_none=True))
    write_audit_log(
        organization_id=payload.organization_id,
        actor_user_id=user_id,
        action="create",
        entity_name="reservations",
        entity_id=created.get("id"),
        before_state=None,
        after_state=created,
    )
    try:
        _sync_turnover_tasks_for_status(created, actor_user_id=user_id)
    except Exception:
        # Task automation is best-effort and should not fail reservation creation.
        pass
    return created


@router.get("/reservations/{reservation_id}")
def get_reservation(reservation_id: str, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("reservations", reservation_id)
    assert_org_member(user_id, record["organization_id"])
    return enrich_reservations([record], record["organization_id"])[0]


@router.patch("/reservations/{reservation_id}")
def update_reservation(reservation_id: str, payload: UpdateReservationInput, user_id: str = Depends(require_user_id)) -> dict:
    record = get_row("reservations", reservation_id)
    assert_org_role(user_id, record["organization_id"], {"owner_admin", "operator"})
    updated = update_row("reservations", reservation_id, payload.model_dump(exclude_none=True))
    write_audit_log(
        organization_id=record.get("organization_id"),
        actor_user_id=user_id,
        action="update",
        entity_name="reservations",
        entity_id=reservation_id,
        before_state=record,
        after_state=updated,
    )
    return updated


@router.post("/reservations/{reservation_id}/status")
def transition_status(reservation_id: str, payload: ReservationStatusInput, user_id: str = Depends(require_user_id)) -> dict:
    reservation = get_row("reservations", reservation_id)
    assert_org_role(user_id, reservation["organization_id"], {"owner_admin", "operator"})
    current_status = reservation["status"]
    if payload.status == current_status:
        return reservation

    if payload.status not in ALLOWED_TRANSITIONS.get(current_status, set()):
        raise HTTPException(status_code=422, detail=f"Invalid status transition: {current_status} -> {payload.status}")

    patch = {"status": payload.status}
    if payload.status == "cancelled":
        patch["cancel_reason"] = payload.reason
    updated = update_row("reservations", reservation_id, patch)
    write_audit_log(
        organization_id=reservation.get("organization_id"),
        actor_user_id=user_id,
        action="status_transition",
        entity_name="reservations",
        entity_id=reservation_id,
        before_state=reservation,
        after_state=updated,
    )
    try:
        _sync_turnover_tasks_for_status(updated, actor_user_id=user_id)
    except Exception:
        # Turnover automation should never block reservation transitions.
        pass

    return updated
