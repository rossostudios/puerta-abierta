import unittest
from datetime import date, datetime, time, timedelta, timezone
from unittest.mock import patch

from app.api.routers.reports import operations_summary_report


def iso_at(day: date, hour: int) -> str:
    return datetime.combine(day, time(hour=hour), tzinfo=timezone.utc).isoformat()


class OperationsSummaryReportTest(unittest.TestCase):
    @patch("app.api.routers.reports.assert_org_member")
    @patch("app.api.routers.reports.list_rows")
    def test_operations_summary_aggregates_turnovers_sla_and_reservations(
        self,
        mock_list_rows,
        mock_assert_org_member,
    ):
        today = date.today()
        period_start = today - timedelta(days=5)
        period_end = today + timedelta(days=5)

        tasks = [
            {
                "id": "task-a",
                "organization_id": "org-1",
                "type": "check_out",
                "status": "done",
                "due_at": iso_at(today - timedelta(days=2), 10),
                "sla_due_at": iso_at(today - timedelta(days=2), 10),
                "completed_at": iso_at(today - timedelta(days=3), 11),
                "sla_breached_at": None,
            },
            {
                "id": "task-b",
                "organization_id": "org-1",
                "type": "cleaning",
                "status": "done",
                "due_at": iso_at(today - timedelta(days=1), 9),
                "sla_due_at": iso_at(today - timedelta(days=1), 9),
                "completed_at": iso_at(today, 9),
                "sla_breached_at": None,
            },
            {
                "id": "task-c",
                "organization_id": "org-1",
                "type": "inspection",
                "status": "todo",
                "due_at": iso_at(today - timedelta(days=1), 8),
                "sla_due_at": iso_at(today - timedelta(days=1), 8),
                "completed_at": None,
                "sla_breached_at": None,
            },
            {
                "id": "task-d",
                "organization_id": "org-1",
                "type": "custom",
                "status": "todo",
                "due_at": iso_at(today - timedelta(days=1), 14),
                "sla_due_at": None,
                "completed_at": None,
                "sla_breached_at": None,
            },
            {
                "id": "task-e",
                "organization_id": "org-1",
                "type": "check_in",
                "status": "in_progress",
                "due_at": iso_at(today + timedelta(days=2), 12),
                "sla_due_at": iso_at(today + timedelta(days=2), 12),
                "completed_at": None,
                "sla_breached_at": None,
            },
        ]

        reservations = [
            {
                "id": "reservation-1",
                "organization_id": "org-1",
                "status": "pending",
                "check_in_date": (today + timedelta(days=1)).isoformat(),
                "check_out_date": (today + timedelta(days=3)).isoformat(),
            },
            {
                "id": "reservation-2",
                "organization_id": "org-1",
                "status": "confirmed",
                "check_in_date": (today + timedelta(days=2)).isoformat(),
                "check_out_date": (today + timedelta(days=7)).isoformat(),
            },
            {
                "id": "reservation-3",
                "organization_id": "org-1",
                "status": "checked_in",
                "check_in_date": (today - timedelta(days=1)).isoformat(),
                "check_out_date": (today + timedelta(days=3)).isoformat(),
            },
            {
                "id": "reservation-4",
                "organization_id": "org-1",
                "status": "cancelled",
                "check_in_date": (today + timedelta(days=2)).isoformat(),
                "check_out_date": (today + timedelta(days=4)).isoformat(),
            },
        ]

        def list_rows_side_effect(
            table: str,
            filters=None,
            limit: int = 50,
            offset: int = 0,
            order_by: str = "created_at",
            ascending: bool = False,
        ):
            del filters, limit, offset, order_by, ascending
            if table == "tasks":
                return [dict(row) for row in tasks]
            if table == "reservations":
                return [dict(row) for row in reservations]
            return []

        mock_list_rows.side_effect = list_rows_side_effect

        result = operations_summary_report(
            org_id="org-1",
            from_date=period_start.isoformat(),
            to_date=period_end.isoformat(),
            user_id="user-1",
        )

        self.assertEqual(result["turnovers_due"], 4)
        self.assertEqual(result["turnovers_completed_on_time"], 1)
        self.assertEqual(result["turnover_on_time_rate"], 0.25)
        self.assertEqual(result["open_tasks"], 3)
        self.assertEqual(result["overdue_tasks"], 2)
        self.assertEqual(result["sla_breached_tasks"], 1)
        self.assertEqual(result["reservations_upcoming_check_in"], 2)
        self.assertEqual(result["reservations_upcoming_check_out"], 1)

        mock_assert_org_member.assert_called_once_with("user-1", "org-1")


if __name__ == "__main__":
    unittest.main()
