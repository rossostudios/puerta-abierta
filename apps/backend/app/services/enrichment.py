from datetime import datetime
from typing import Any, Iterable, Optional

from app.services.table_service import list_rows

AUTO_TURNOVER_TASK_TYPES = {"check_in", "check_out", "cleaning", "inspection"}


def _map_by_id(rows: Iterable[dict[str, Any]], name_key: str = "name") -> dict[str, str]:
    mapping: dict[str, str] = {}
    for row in rows:
        row_id = row.get("id")
        if not isinstance(row_id, str):
            continue
        value = row.get(name_key)
        if isinstance(value, str) and value.strip():
            mapping[row_id] = value.strip()
    return mapping


def _parse_datetime(value: object) -> Optional[datetime]:
    if not isinstance(value, str):
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


def _infer_automation_source(
    task: dict[str, Any], reservation: Optional[dict[str, Any]]
) -> Optional[str]:
    task_type = str(task.get("type") or "").strip().lower()
    reservation_id = str(task.get("reservation_id") or "").strip()
    if task_type not in AUTO_TURNOVER_TASK_TYPES or not reservation_id:
        return None

    task_created_at = _parse_datetime(task.get("created_at"))
    reservation_created_at = _parse_datetime(
        reservation.get("created_at") if reservation else None
    )
    reservation_status = (
        str(reservation.get("status") or "").strip().lower() if reservation else ""
    )

    if (
        task_type == "check_in"
        and task_created_at
        and reservation_created_at
        and abs((task_created_at - reservation_created_at).total_seconds()) <= 300
        and reservation_status in {"pending", "confirmed"}
    ):
        return "reservation_create"

    return "reservation_status_transition"


def enrich_units(units: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    property_ids = {row.get("property_id") for row in units if isinstance(row.get("property_id"), str)}
    if property_ids:
        properties = list_rows("properties", {"organization_id": org_id, "id": list(property_ids)}, limit=min(5000, len(property_ids)))
        property_name = _map_by_id(properties, "name")
        for unit in units:
            pid = unit.get("property_id")
            if isinstance(pid, str):
                unit["property_name"] = property_name.get(pid)
    return units


def enrich_listings(listings: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    unit_ids = {row.get("unit_id") for row in listings if isinstance(row.get("unit_id"), str)}
    channel_ids = {row.get("channel_id") for row in listings if isinstance(row.get("channel_id"), str)}

    unit_name: dict[str, str] = {}
    unit_property: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
        unit_name = _map_by_id(units, "name")
        for unit in units:
            uid = unit.get("id")
            pid = unit.get("property_id")
            if isinstance(uid, str) and isinstance(pid, str):
                unit_property[uid] = pid

    channel_name: dict[str, str] = {}
    if channel_ids:
        channels = list_rows("channels", {"organization_id": org_id, "id": list(channel_ids)}, limit=min(5000, len(channel_ids)))
        channel_name = _map_by_id(channels, "name")

    property_ids = {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if property_ids:
        properties = list_rows("properties", {"organization_id": org_id, "id": list(property_ids)}, limit=min(5000, len(property_ids)))
        property_name = _map_by_id(properties, "name")

    for listing in listings:
        uid = listing.get("unit_id")
        cid = listing.get("channel_id")
        if isinstance(uid, str):
            listing["unit_name"] = unit_name.get(uid)
            pid = unit_property.get(uid)
            if pid:
                listing["property_id"] = pid
                listing["property_name"] = property_name.get(pid)
        if isinstance(cid, str):
            listing["channel_name"] = channel_name.get(cid)

    return listings


def enrich_reservations(reservations: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    unit_ids = {row.get("unit_id") for row in reservations if isinstance(row.get("unit_id"), str)}
    guest_ids = {row.get("guest_id") for row in reservations if isinstance(row.get("guest_id"), str)}
    channel_ids = {row.get("channel_id") for row in reservations if isinstance(row.get("channel_id"), str)}
    listing_ids = {row.get("listing_id") for row in reservations if isinstance(row.get("listing_id"), str)}

    unit_name: dict[str, str] = {}
    unit_property: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
        unit_name = _map_by_id(units, "name")
        for unit in units:
            uid = unit.get("id")
            pid = unit.get("property_id")
            if isinstance(uid, str) and isinstance(pid, str):
                unit_property[uid] = pid

    property_ids = {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if property_ids:
        properties = list_rows("properties", {"organization_id": org_id, "id": list(property_ids)}, limit=min(5000, len(property_ids)))
        property_name = _map_by_id(properties, "name")

    guest_name: dict[str, str] = {}
    if guest_ids:
        guests = list_rows("guests", {"organization_id": org_id, "id": list(guest_ids)}, limit=min(5000, len(guest_ids)))
        guest_name = _map_by_id(guests, "full_name")

    channel_name: dict[str, str] = {}
    if channel_ids:
        channels = list_rows("channels", {"organization_id": org_id, "id": list(channel_ids)}, limit=min(5000, len(channel_ids)))
        channel_name = _map_by_id(channels, "name")

    listing_name: dict[str, str] = {}
    if listing_ids:
        listings = list_rows("listings", {"organization_id": org_id, "id": list(listing_ids)}, limit=min(5000, len(listing_ids)))
        listing_name = _map_by_id(listings, "public_name")

    reservation_ids = {
        row.get("id")
        for row in reservations
        if isinstance(row.get("id"), str)
    }
    reservation_lookup = {
        str(row.get("id")): row
        for row in reservations
        if isinstance(row.get("id"), str)
    }
    auto_source_by_reservation: dict[str, str | None] = {}
    auto_count_by_reservation: dict[str, int] = {}
    if reservation_ids:
        related_tasks = list_rows(
            "tasks",
            {"organization_id": org_id, "reservation_id": list(reservation_ids)},
            limit=min(20000, max(3000, len(reservation_ids) * 20)),
        )
        for task in related_tasks:
            reservation_id = task.get("reservation_id")
            task_type = str(task.get("type") or "").strip().lower()
            if not isinstance(reservation_id, str):
                continue
            if task_type not in AUTO_TURNOVER_TASK_TYPES:
                continue

            auto_count_by_reservation[reservation_id] = (
                auto_count_by_reservation.get(reservation_id, 0) + 1
            )
            source = _infer_automation_source(
                task, reservation_lookup.get(reservation_id)
            )
            if source == "reservation_create":
                auto_source_by_reservation[reservation_id] = "reservation_create"
            elif reservation_id not in auto_source_by_reservation:
                auto_source_by_reservation[reservation_id] = source

    for reservation in reservations:
        reservation_id = reservation.get("id")
        uid = reservation.get("unit_id")
        if isinstance(uid, str):
            reservation["unit_name"] = unit_name.get(uid)
            pid = unit_property.get(uid)
            if pid:
                reservation["property_id"] = pid
                reservation["property_name"] = property_name.get(pid)

        gid = reservation.get("guest_id")
        if isinstance(gid, str):
            reservation["guest_name"] = guest_name.get(gid)

        cid = reservation.get("channel_id")
        if isinstance(cid, str):
            reservation["channel_name"] = channel_name.get(cid)

        lid = reservation.get("listing_id")
        if isinstance(lid, str):
            reservation["listing_name"] = listing_name.get(lid)

        if isinstance(reservation_id, str):
            automation_source = auto_source_by_reservation.get(reservation_id)
            reservation["automation_source"] = automation_source
            reservation["auto_generated_task_count"] = auto_count_by_reservation.get(
                reservation_id, 0
            )
            reservation["has_auto_generated_tasks"] = bool(
                auto_count_by_reservation.get(reservation_id, 0)
            )
        else:
            reservation["automation_source"] = None
            reservation["auto_generated_task_count"] = 0
            reservation["has_auto_generated_tasks"] = False

    return reservations


def enrich_calendar_blocks(blocks: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    unit_ids = {row.get("unit_id") for row in blocks if isinstance(row.get("unit_id"), str)}
    if not unit_ids:
        return blocks

    units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
    unit_name = _map_by_id(units, "name")
    unit_property: dict[str, str] = {}
    for unit in units:
        uid = unit.get("id")
        pid = unit.get("property_id")
        if isinstance(uid, str) and isinstance(pid, str):
            unit_property[uid] = pid

    property_ids = {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if property_ids:
        properties = list_rows("properties", {"organization_id": org_id, "id": list(property_ids)}, limit=min(5000, len(property_ids)))
        property_name = _map_by_id(properties, "name")

    for block in blocks:
        uid = block.get("unit_id")
        if not isinstance(uid, str):
            continue
        block["unit_name"] = unit_name.get(uid)
        pid = unit_property.get(uid)
        if pid:
            block["property_id"] = pid
            block["property_name"] = property_name.get(pid)
    return blocks


def enrich_tasks(tasks: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    property_ids = {row.get("property_id") for row in tasks if isinstance(row.get("property_id"), str)}
    unit_ids = {row.get("unit_id") for row in tasks if isinstance(row.get("unit_id"), str)}
    task_ids = {row.get("id") for row in tasks if isinstance(row.get("id"), str)}
    reservation_ids = {
        row.get("reservation_id")
        for row in tasks
        if isinstance(row.get("reservation_id"), str)
    }

    unit_name: dict[str, str] = {}
    unit_property: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
        unit_name = _map_by_id(units, "name")
        for unit in units:
            uid = unit.get("id")
            pid = unit.get("property_id")
            if isinstance(uid, str) and isinstance(pid, str):
                unit_property[uid] = pid

    checklist_counts: dict[str, dict[str, int]] = {}
    if task_ids:
        items = list_rows(
            "task_items",
            {"task_id": list(task_ids)},
            # Best-effort: PostgREST may cap this, but we still get useful counts.
            limit=min(20000, max(2000, len(task_ids) * 20)),
        )
        for item in items:
            task_id = item.get("task_id")
            if not isinstance(task_id, str):
                continue
            counts = checklist_counts.get(task_id)
            if not counts:
                counts = {
                    "total": 0,
                    "completed": 0,
                    "required_total": 0,
                    "required_completed": 0,
                }
                checklist_counts[task_id] = counts

            counts["total"] += 1
            completed = bool(item.get("is_completed"))
            required = bool(item.get("is_required"))
            if completed:
                counts["completed"] += 1
            if required:
                counts["required_total"] += 1
                if completed:
                    counts["required_completed"] += 1

    reservations_by_id: dict[str, dict[str, Any]] = {}
    if reservation_ids:
        reservations = list_rows(
            "reservations",
            {"organization_id": org_id, "id": list(reservation_ids)},
            limit=min(5000, len(reservation_ids)),
        )
        for reservation in reservations:
            reservation_id = reservation.get("id")
            if isinstance(reservation_id, str):
                reservations_by_id[reservation_id] = reservation

    all_property_ids = {pid for pid in property_ids if isinstance(pid, str)} | {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if all_property_ids:
        properties = list_rows(
            "properties",
            {"organization_id": org_id, "id": list(all_property_ids)},
            limit=min(5000, len(all_property_ids)),
        )
        property_name = _map_by_id(properties, "name")

    for task in tasks:
        pid = task.get("property_id")
        if isinstance(pid, str):
            task["property_name"] = property_name.get(pid)

        uid = task.get("unit_id")
        if isinstance(uid, str):
            task["unit_name"] = unit_name.get(uid)
            derived_pid = unit_property.get(uid)
            if derived_pid and not task.get("property_id"):
                task["property_id"] = derived_pid
                task["property_name"] = property_name.get(derived_pid)

        tid = task.get("id")
        if isinstance(tid, str):
            counts = checklist_counts.get(tid) or {}
            total = int(counts.get("total") or 0)
            completed = int(counts.get("completed") or 0)
            required_total = int(counts.get("required_total") or 0)
            required_completed = int(counts.get("required_completed") or 0)
            task["checklist_total"] = total
            task["checklist_completed"] = completed
            task["checklist_required_total"] = required_total
            task["checklist_required_remaining"] = max(
                required_total - required_completed, 0
            )

        reservation_id = task.get("reservation_id")
        reservation = (
            reservations_by_id.get(reservation_id)
            if isinstance(reservation_id, str)
            else None
        )
        automation_source = _infer_automation_source(task, reservation)
        task["automation_source"] = automation_source
        task["auto_generated"] = bool(automation_source)

    return tasks


def enrich_expenses(expenses: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    property_ids = {row.get("property_id") for row in expenses if isinstance(row.get("property_id"), str)}
    unit_ids = {row.get("unit_id") for row in expenses if isinstance(row.get("unit_id"), str)}

    unit_name: dict[str, str] = {}
    unit_property: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
        unit_name = _map_by_id(units, "name")
        for unit in units:
            uid = unit.get("id")
            pid = unit.get("property_id")
            if isinstance(uid, str) and isinstance(pid, str):
                unit_property[uid] = pid

    all_property_ids = {pid for pid in property_ids if isinstance(pid, str)} | {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if all_property_ids:
        properties = list_rows(
            "properties",
            {"organization_id": org_id, "id": list(all_property_ids)},
            limit=min(5000, len(all_property_ids)),
        )
        property_name = _map_by_id(properties, "name")

    for expense in expenses:
        pid = expense.get("property_id")
        if isinstance(pid, str):
            expense["property_name"] = property_name.get(pid)

        uid = expense.get("unit_id")
        if isinstance(uid, str):
            expense["unit_name"] = unit_name.get(uid)
            derived_pid = unit_property.get(uid)
            if derived_pid and not expense.get("property_id"):
                expense["property_id"] = derived_pid
                expense["property_name"] = property_name.get(derived_pid)

    return expenses


def enrich_owner_statements(statements: list[dict[str, Any]], org_id: str) -> list[dict[str, Any]]:
    property_ids = {row.get("property_id") for row in statements if isinstance(row.get("property_id"), str)}
    unit_ids = {row.get("unit_id") for row in statements if isinstance(row.get("unit_id"), str)}

    unit_name: dict[str, str] = {}
    unit_property: dict[str, str] = {}
    if unit_ids:
        units = list_rows("units", {"organization_id": org_id, "id": list(unit_ids)}, limit=min(5000, len(unit_ids)))
        unit_name = _map_by_id(units, "name")
        for unit in units:
            uid = unit.get("id")
            pid = unit.get("property_id")
            if isinstance(uid, str) and isinstance(pid, str):
                unit_property[uid] = pid

    all_property_ids = {pid for pid in property_ids if isinstance(pid, str)} | {pid for pid in unit_property.values()}
    property_name: dict[str, str] = {}
    if all_property_ids:
        properties = list_rows(
            "properties",
            {"organization_id": org_id, "id": list(all_property_ids)},
            limit=min(5000, len(all_property_ids)),
        )
        property_name = _map_by_id(properties, "name")

    for statement in statements:
        pid = statement.get("property_id")
        if isinstance(pid, str):
            statement["property_name"] = property_name.get(pid)
        uid = statement.get("unit_id")
        if isinstance(uid, str):
            statement["unit_name"] = unit_name.get(uid)
            derived_pid = unit_property.get(uid)
            if derived_pid and not statement.get("property_id"):
                statement["property_id"] = derived_pid
                statement["property_name"] = property_name.get(derived_pid)
    return statements
