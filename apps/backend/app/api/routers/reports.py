from datetime import date, datetime
from statistics import median

from fastapi import APIRouter, Depends, Query
from typing import Optional

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member
from app.services.pricing import missing_required_fee_types
from app.services.table_service import list_rows

router = APIRouter(tags=["Reports"])

REPORTABLE_STATUSES = {"confirmed", "checked_in", "checked_out"}
ACTIVE_TASK_STATUSES = {"todo", "in_progress"}
TURNOVER_TASK_TYPES = {"check_in", "check_out", "cleaning", "inspection"}
UPCOMING_CHECK_IN_STATUSES = {"pending", "confirmed"}
UPCOMING_CHECK_OUT_STATUSES = {"confirmed", "checked_in"}


def _parse_date(value: str) -> date:
    return date.fromisoformat(value)


def _nights(start: date, end: date) -> int:
    return max((end - start).days, 0)


def _parse_datetime(value: str) -> datetime:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    return datetime.fromisoformat(text)


def _datetime_or_none(value: object) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    try:
        return _parse_datetime(value)
    except Exception:
        return None


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


@router.get("/reports/owner-summary")
@router.get("/reports/summary")
def owner_summary_report(
    org_id: str = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    property_id: Optional[str] = Query(None),
    unit_id: Optional[str] = Query(None),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)
    period_start = _parse_date(from_date)
    period_end = _parse_date(to_date)
    total_days = _nights(period_start, period_end)

    units = list_rows("units", {"organization_id": org_id}, limit=3000)
    if property_id:
        units = [unit for unit in units if unit.get("property_id") == property_id]
    if unit_id:
        units = [unit for unit in units if unit.get("id") == unit_id]
    unit_count = max(len(units), 1)
    available_nights = max(total_days * unit_count, 1)

    reservations = list_rows("reservations", {"organization_id": org_id}, limit=6000)
    if unit_id:
        reservations = [item for item in reservations if item.get("unit_id") == unit_id]
    if property_id:
        units_in_property = {unit["id"] for unit in units}
        reservations = [item for item in reservations if item.get("unit_id") in units_in_property]

    booked_nights = 0
    gross_revenue = 0.0
    for reservation in reservations:
        if reservation.get("status") not in REPORTABLE_STATUSES:
            continue
        check_in = _parse_date(reservation["check_in_date"])
        check_out = _parse_date(reservation["check_out_date"])
        if check_out <= period_start or check_in >= period_end:
            continue
        overlap_start = max(check_in, period_start)
        overlap_end = min(check_out, period_end)
        booked_nights += _nights(overlap_start, overlap_end)
        gross_revenue += float(reservation.get("total_amount", 0) or 0)

    expenses = list_rows("expenses", {"organization_id": org_id}, limit=6000)
    if unit_id:
        expenses = [item for item in expenses if item.get("unit_id") == unit_id]
    if property_id:
        expenses = [item for item in expenses if item.get("property_id") == property_id]

    total_expenses = 0.0
    warnings: dict[str, int] = {}
    for expense in expenses:
        expense_date = _parse_date(expense["expense_date"])
        if period_start <= expense_date <= period_end:
            amount_pyg, warning = _expense_amount_pyg(expense)
            total_expenses += amount_pyg
            if warning:
                warnings[warning] = (warnings.get(warning, 0) or 0) + 1

    occupancy_rate = round(booked_nights / available_nights, 4)
    net_payout = round(gross_revenue - total_expenses, 2)

    return {
        "organization_id": org_id,
        "from": from_date,
        "to": to_date,
        "occupancy_rate": occupancy_rate,
        "gross_revenue": round(gross_revenue, 2),
        "expenses": round(total_expenses, 2),
        "net_payout": net_payout,
        "expense_warnings": warnings,
    }


@router.get("/reports/operations-summary")
def operations_summary_report(
    org_id: str = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    period_start = _parse_date(from_date)
    period_end = _parse_date(to_date)
    now_utc = datetime.utcnow().date()

    tasks = list_rows("tasks", {"organization_id": org_id}, limit=20000)

    turnovers_due = 0
    turnovers_completed_on_time = 0
    open_tasks = 0
    overdue_tasks = 0
    sla_breached_tasks = 0

    for task in tasks:
        task_type = str(task.get("type") or "").strip().lower()
        status = str(task.get("status") or "").strip().lower()

        due_at = _datetime_or_none(task.get("due_at"))
        due_date = due_at.date() if due_at else None
        sla_due_at = _datetime_or_none(task.get("sla_due_at"))
        completed_at = _datetime_or_none(task.get("completed_at"))
        sla_breached_at = _datetime_or_none(task.get("sla_breached_at"))

        if status in ACTIVE_TASK_STATUSES:
            open_tasks += 1
            if due_date and due_date < now_utc:
                overdue_tasks += 1

        if sla_breached_at or (
            status in ACTIVE_TASK_STATUSES
            and sla_due_at
            and sla_due_at.date() < now_utc
        ):
            sla_breached_tasks += 1

        if task_type not in TURNOVER_TASK_TYPES:
            continue
        if not due_date:
            continue
        if due_date < period_start or due_date > period_end:
            continue

        turnovers_due += 1
        if status != "done":
            continue

        reference_due = sla_due_at or due_at
        if reference_due and completed_at and completed_at <= reference_due:
            turnovers_completed_on_time += 1
        elif completed_at and not reference_due:
            turnovers_completed_on_time += 1

    turnover_on_time_rate = (
        round(turnovers_completed_on_time / turnovers_due, 4)
        if turnovers_due
        else 0.0
    )

    reservations = list_rows("reservations", {"organization_id": org_id}, limit=20000)
    reservations_upcoming_check_in = 0
    reservations_upcoming_check_out = 0

    for reservation in reservations:
        status = str(reservation.get("status") or "").strip().lower()

        check_in_raw = reservation.get("check_in_date")
        if isinstance(check_in_raw, str):
            try:
                check_in_date = _parse_date(check_in_raw)
            except Exception:
                check_in_date = None
            if (
                check_in_date
                and period_start <= check_in_date <= period_end
                and status in UPCOMING_CHECK_IN_STATUSES
            ):
                reservations_upcoming_check_in += 1

        check_out_raw = reservation.get("check_out_date")
        if isinstance(check_out_raw, str):
            try:
                check_out_date = _parse_date(check_out_raw)
            except Exception:
                check_out_date = None
            if (
                check_out_date
                and period_start <= check_out_date <= period_end
                and status in UPCOMING_CHECK_OUT_STATUSES
            ):
                reservations_upcoming_check_out += 1

    return {
        "organization_id": org_id,
        "from": from_date,
        "to": to_date,
        "turnovers_due": turnovers_due,
        "turnovers_completed_on_time": turnovers_completed_on_time,
        "turnover_on_time_rate": turnover_on_time_rate,
        "open_tasks": open_tasks,
        "overdue_tasks": overdue_tasks,
        "sla_breached_tasks": sla_breached_tasks,
        "reservations_upcoming_check_in": reservations_upcoming_check_in,
        "reservations_upcoming_check_out": reservations_upcoming_check_out,
    }


@router.get("/reports/transparency-summary")
def transparency_summary_report(
    org_id: str = Query(...),
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    user_id: str = Depends(require_user_id),
) -> dict:
    assert_org_member(user_id, org_id)

    period_start = _parse_date(from_date)
    period_end = _parse_date(to_date)

    listings = list_rows("marketplace_listings", {"organization_id": org_id}, limit=6000)
    listing_ids = [str(item.get("id") or "") for item in listings if item.get("id")]

    fee_lines = list_rows(
        "marketplace_listing_fee_lines",
        {"marketplace_listing_id": listing_ids} if listing_ids else {"organization_id": org_id},
        limit=max(1000, len(listing_ids) * 20 if listing_ids else 1000),
        order_by="sort_order",
        ascending=True,
    )

    lines_by_listing: dict[str, list[dict]] = {}
    for line in fee_lines:
        key = str(line.get("marketplace_listing_id") or "")
        if not key:
            continue
        lines_by_listing.setdefault(key, []).append(line)

    published_count = 0
    transparent_count = 0
    for listing in listings:
        if not bool(listing.get("is_published")):
            continue
        published_count += 1
        listing_id = str(listing.get("id") or "")
        missing = missing_required_fee_types(lines_by_listing.get(listing_id, []))
        if not missing:
            transparent_count += 1

    transparent_listings_pct = round(transparent_count / published_count, 4) if published_count else 0.0

    applications = list_rows("application_submissions", {"organization_id": org_id}, limit=12000)

    in_period_apps: list[dict] = []
    first_response_hours: list[float] = []
    qualified_like_statuses = {"qualified", "visit_scheduled", "offer_sent", "contract_signed"}
    qualified_count = 0

    for application in applications:
        created_raw = application.get("created_at")
        if not isinstance(created_raw, str):
            continue
        try:
            created_at = _parse_datetime(created_raw)
        except Exception:
            continue
        created_date = created_at.date()
        if created_date < period_start or created_date > period_end:
            continue
        in_period_apps.append(application)

        status = str(application.get("status") or "")
        if status in qualified_like_statuses:
            qualified_count += 1

        first_response_raw = application.get("first_response_at")
        if isinstance(first_response_raw, str):
            try:
                first_response_at = _parse_datetime(first_response_raw)
                elapsed_hours = max((first_response_at - created_at).total_seconds(), 0) / 3600
                first_response_hours.append(elapsed_hours)
            except Exception:
                pass

    applications_count = len(in_period_apps)
    inquiry_to_qualified_rate = (
        round(qualified_count / applications_count, 4) if applications_count else 0.0
    )
    median_first_response_hours = round(median(first_response_hours), 2) if first_response_hours else None

    collections = list_rows("collection_records", {"organization_id": org_id}, limit=20000)
    in_period_collections = [
        row
        for row in collections
        if isinstance(row.get("due_date"), str)
        and period_start <= _parse_date(str(row.get("due_date"))) <= period_end
    ]

    total_collections = len(in_period_collections)
    paid_collections = sum(1 for row in in_period_collections if str(row.get("status") or "") == "paid")
    collection_success_rate = round(paid_collections / total_collections, 4) if total_collections else 0.0

    paid_amount = round(
        sum(float(row.get("amount", 0) or 0) for row in in_period_collections if str(row.get("status") or "") == "paid"),
        2,
    )

    alert_events = list_rows(
        "integration_events",
        {"organization_id": org_id, "provider": "alerting"},
        limit=20000,
        order_by="received_at",
        ascending=False,
    )

    application_submit_failures = 0
    application_event_write_failures = 0
    for event in alert_events:
        event_type = str(event.get("event_type") or "")
        if event_type not in {"application_submit_failed", "application_event_write_failed"}:
            continue

        received_raw = event.get("received_at")
        if not isinstance(received_raw, str):
            continue

        try:
            received_date = _parse_datetime(received_raw).date()
        except Exception:
            continue

        if received_date < period_start or received_date > period_end:
            continue

        if event_type == "application_submit_failed":
            application_submit_failures += 1
        else:
            application_event_write_failures += 1

    application_submit_attempts = applications_count + application_submit_failures
    application_submit_failure_rate = (
        round(application_submit_failures / application_submit_attempts, 4)
        if application_submit_attempts
        else 0.0
    )

    return {
        "organization_id": org_id,
        "from": from_date,
        "to": to_date,
        "published_listings": published_count,
        "transparent_listings": transparent_count,
        "transparent_listings_pct": transparent_listings_pct,
        "applications": applications_count,
        "qualified_applications": qualified_count,
        "inquiry_to_qualified_rate": inquiry_to_qualified_rate,
        "median_first_response_hours": median_first_response_hours,
        "collections_scheduled": total_collections,
        "collections_paid": paid_collections,
        "collection_success_rate": collection_success_rate,
        "paid_collections_amount": paid_amount,
        "application_submit_failures": application_submit_failures,
        "application_event_write_failures": application_event_write_failures,
        "application_submit_failure_rate": application_submit_failure_rate,
    }
