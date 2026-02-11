import unittest
from unittest.mock import patch

from app.services.lease_schedule import (
    build_monthly_schedule_dates,
    ensure_monthly_lease_schedule,
)


class LeaseScheduleServiceTest(unittest.TestCase):
    def test_build_monthly_schedule_dates_uses_end_date_with_day_clamp(self):
        schedule = build_monthly_schedule_dates(
            starts_on="2026-05-31",
            ends_on="2026-08-31",
        )

        self.assertEqual(
            [item.isoformat() for item in schedule],
            ["2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31"],
        )

    def test_build_monthly_schedule_dates_defaults_to_12_months(self):
        schedule = build_monthly_schedule_dates(starts_on="2026-05-15")

        self.assertEqual(len(schedule), 12)
        self.assertEqual(schedule[0].isoformat(), "2026-05-15")
        self.assertEqual(schedule[-1].isoformat(), "2027-04-15")

    @patch("app.services.lease_schedule.create_row")
    @patch("app.services.lease_schedule.list_rows")
    def test_ensure_monthly_lease_schedule_is_idempotent(self, mock_list_rows, mock_create_row):
        existing_charge = {
            "id": "charge-existing",
            "lease_id": "lease-1",
            "charge_type": "monthly_rent",
            "charge_date": "2026-05-01",
            "amount": 1000,
            "currency": "PYG",
        }
        existing_collection = {
            "id": "collection-existing",
            "lease_id": "lease-1",
            "lease_charge_id": "charge-existing",
            "due_date": "2026-05-01",
            "amount": 1000,
            "currency": "PYG",
            "status": "scheduled",
        }

        def list_rows_side_effect(
            table: str,
            filters=None,
            limit: int = 50,
            offset: int = 0,
            order_by: str = "created_at",
            ascending: bool = False,
        ):
            del filters, limit, offset, order_by, ascending
            if table == "lease_charges":
                return [existing_charge]
            if table == "collection_records":
                return [existing_collection]
            return []

        created_rows: list[tuple[str, dict]] = []

        def create_row_side_effect(table: str, payload: dict):
            row_id = f"{table}-{len(created_rows) + 1}"
            row = {"id": row_id, **payload}
            created_rows.append((table, row))
            return row

        mock_list_rows.side_effect = list_rows_side_effect
        mock_create_row.side_effect = create_row_side_effect

        result = ensure_monthly_lease_schedule(
            organization_id="org-1",
            lease_id="lease-1",
            starts_on="2026-05-01",
            first_collection_due_date=None,
            ends_on=None,
            collection_schedule_months=3,
            amount=1000,
            currency="PYG",
            created_by_user_id="user-1",
        )

        self.assertEqual(result["due_dates"], ["2026-05-01", "2026-06-01", "2026-07-01"])
        self.assertEqual(len(result["charges"]), 2)
        self.assertEqual(len(result["collections"]), 2)
        self.assertEqual(result["first_collection"]["id"], "collection-existing")

        self.assertEqual(mock_create_row.call_count, 4)
        created_charge_dates = [
            row["charge_date"]
            for table, row in created_rows
            if table == "lease_charges"
        ]
        created_collection_dates = [
            row["due_date"]
            for table, row in created_rows
            if table == "collection_records"
        ]
        self.assertEqual(created_charge_dates, ["2026-06-01", "2026-07-01"])
        self.assertEqual(created_collection_dates, ["2026-06-01", "2026-07-01"])


if __name__ == "__main__":
    unittest.main()
