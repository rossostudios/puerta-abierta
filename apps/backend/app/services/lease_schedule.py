from calendar import monthrange
from datetime import date
from typing import Optional

from fastapi import HTTPException

from app.services.table_service import create_row, list_rows

DEFAULT_COLLECTION_SCHEDULE_MONTHS = 12
MAX_COLLECTION_SCHEDULE_MONTHS = 120


def _parse_iso_date(value: str, *, field_name: str) -> date:
    try:
        return date.fromisoformat(value)
    except Exception as exc:  # pragma: no cover - defensive validation
        raise HTTPException(status_code=400, detail=f"{field_name} must be an ISO date (YYYY-MM-DD).") from exc


def _add_months_clamped(anchor: date, offset: int) -> date:
    month_index = (anchor.month - 1) + offset
    year = anchor.year + (month_index // 12)
    month = (month_index % 12) + 1
    day = min(anchor.day, monthrange(year, month)[1])
    return date(year, month, day)


def build_monthly_schedule_dates(
    *,
    starts_on: str,
    first_collection_due_date: Optional[str] = None,
    ends_on: Optional[str] = None,
    collection_schedule_months: Optional[int] = None,
) -> list[date]:
    starts_on_date = _parse_iso_date(starts_on, field_name="starts_on")
    due_anchor = _parse_iso_date(
        first_collection_due_date or starts_on,
        field_name="first_collection_due_date",
    )

    if ends_on:
        end_date = _parse_iso_date(ends_on, field_name="ends_on")
        schedule: list[date] = []
        for offset in range(MAX_COLLECTION_SCHEDULE_MONTHS):
            due_date = _add_months_clamped(due_anchor, offset)
            if due_date > end_date:
                break
            schedule.append(due_date)

        if schedule:
            return schedule
        # Keep at least one due date when ends_on is earlier than starts/anchor.
        return [due_anchor if due_anchor >= starts_on_date else starts_on_date]

    months = collection_schedule_months or DEFAULT_COLLECTION_SCHEDULE_MONTHS
    if months < 1:
        raise HTTPException(status_code=400, detail="collection_schedule_months must be >= 1.")
    months = min(months, MAX_COLLECTION_SCHEDULE_MONTHS)

    return [_add_months_clamped(due_anchor, offset) for offset in range(months)]


def ensure_monthly_lease_schedule(
    *,
    organization_id: str,
    lease_id: str,
    starts_on: str,
    first_collection_due_date: Optional[str],
    ends_on: Optional[str],
    collection_schedule_months: Optional[int],
    amount: float,
    currency: str,
    created_by_user_id: Optional[str],
) -> dict:
    due_dates = build_monthly_schedule_dates(
        starts_on=starts_on,
        first_collection_due_date=first_collection_due_date,
        ends_on=ends_on,
        collection_schedule_months=collection_schedule_months,
    )
    due_keys = {item.isoformat() for item in due_dates}

    existing_charges = list_rows(
        "lease_charges",
        {"lease_id": lease_id},
        limit=max(300, len(due_dates) * 4),
        order_by="charge_date",
        ascending=True,
    )
    existing_charge_by_due: dict[str, dict] = {}
    for charge in existing_charges:
        if str(charge.get("charge_type") or "") != "monthly_rent":
            continue
        charge_date = str(charge.get("charge_date") or "")
        if charge_date in due_keys and charge_date not in existing_charge_by_due:
            existing_charge_by_due[charge_date] = charge

    existing_collections = list_rows(
        "collection_records",
        {"lease_id": lease_id},
        limit=max(300, len(due_dates) * 4),
        order_by="due_date",
        ascending=True,
    )
    existing_collection_by_due: dict[str, dict] = {}
    for collection in existing_collections:
        due_date = str(collection.get("due_date") or "")
        if due_date in due_keys and due_date not in existing_collection_by_due:
            existing_collection_by_due[due_date] = collection

    created_charges: list[dict] = []
    created_collections: list[dict] = []
    first_collection: Optional[dict] = None

    for index, due_date in enumerate(due_dates):
        due_iso = due_date.isoformat()

        charge = existing_charge_by_due.get(due_iso)
        if not charge:
            charge = create_row(
                "lease_charges",
                {
                    "organization_id": organization_id,
                    "lease_id": lease_id,
                    "charge_date": due_iso,
                    "charge_type": "monthly_rent",
                    "description": f"Recurring monthly lease charge ({due_iso})",
                    "amount": round(float(amount or 0), 2),
                    "currency": currency,
                    "status": "scheduled",
                },
            )
            existing_charge_by_due[due_iso] = charge
            created_charges.append(charge)

        collection = existing_collection_by_due.get(due_iso)
        if not collection:
            collection = create_row(
                "collection_records",
                {
                    "organization_id": organization_id,
                    "lease_id": lease_id,
                    "lease_charge_id": charge.get("id"),
                    "due_date": due_iso,
                    "amount": round(float(amount or 0), 2),
                    "currency": currency,
                    "status": "scheduled",
                    "created_by_user_id": created_by_user_id,
                },
            )
            existing_collection_by_due[due_iso] = collection
            created_collections.append(collection)

        if index == 0:
            first_collection = collection

    return {
        "due_dates": [item.isoformat() for item in due_dates],
        "charges": created_charges,
        "collections": created_collections,
        "first_collection": first_collection,
    }
