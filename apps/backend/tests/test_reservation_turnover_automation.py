import unittest
from unittest.mock import patch

from app.api.routers.reservations import (
    _sync_turnover_tasks_for_status,
    create_reservation,
    transition_status,
)
from app.schemas.domain import CreateReservationInput, ReservationStatusInput


class ReservationTurnoverAutomationTest(unittest.TestCase):
    @patch("app.api.routers.reservations._sync_turnover_tasks_for_status")
    @patch("app.api.routers.reservations.write_audit_log")
    @patch("app.api.routers.reservations.create_row")
    @patch("app.api.routers.reservations._has_overlap")
    @patch("app.api.routers.reservations.assert_org_role")
    def test_create_reservation_triggers_turnover_sync(
        self,
        mock_assert_org_role,
        mock_has_overlap,
        mock_create_row,
        mock_write_audit_log,
        mock_sync_turnover,
    ):
        del mock_assert_org_role, mock_write_audit_log
        mock_has_overlap.return_value = False
        mock_create_row.return_value = {
            "id": "reservation-create-1",
            "organization_id": "org-1",
            "unit_id": "unit-1",
            "status": "confirmed",
            "check_in_date": "2026-06-10",
            "check_out_date": "2026-06-14",
        }

        payload = CreateReservationInput(
            organization_id="org-1",
            unit_id="unit-1",
            status="confirmed",
            source="manual",
            check_in_date="2026-06-10",
            check_out_date="2026-06-14",
            total_amount=500.0,
        )

        result = create_reservation(payload, user_id="operator-1")

        self.assertEqual(result["id"], "reservation-create-1")
        mock_sync_turnover.assert_called_once_with(result, actor_user_id="operator-1")

    @patch("app.api.routers.reservations._sync_turnover_tasks_for_status")
    @patch("app.api.routers.reservations.write_audit_log")
    @patch("app.api.routers.reservations.update_row")
    @patch("app.api.routers.reservations.assert_org_role")
    @patch("app.api.routers.reservations.get_row")
    def test_status_transition_triggers_turnover_sync(
        self,
        mock_get_row,
        mock_assert_org_role,
        mock_update_row,
        mock_write_audit_log,
        mock_sync_turnover,
    ):
        del mock_assert_org_role, mock_write_audit_log

        mock_get_row.return_value = {
            "id": "reservation-4",
            "organization_id": "org-1",
            "unit_id": "unit-1",
            "status": "confirmed",
            "check_in_date": "2026-06-10",
            "check_out_date": "2026-06-14",
        }
        mock_update_row.return_value = {
            "id": "reservation-4",
            "organization_id": "org-1",
            "unit_id": "unit-1",
            "status": "checked_in",
            "check_in_date": "2026-06-10",
            "check_out_date": "2026-06-14",
        }

        payload = ReservationStatusInput(status="checked_in")
        result = transition_status("reservation-4", payload, user_id="operator-1")

        self.assertEqual(result["status"], "checked_in")
        mock_sync_turnover.assert_called_once_with(result, actor_user_id="operator-1")

    @patch("app.api.routers.reservations.create_row")
    @patch("app.api.routers.reservations.list_rows")
    @patch("app.api.routers.reservations.get_row")
    def test_confirmed_status_creates_check_in_task_and_checklist(
        self,
        mock_get_row,
        mock_list_rows,
        mock_create_row,
    ):
        created_tasks: list[dict] = []
        created_items: list[dict] = []

        reservation = {
            "id": "reservation-1",
            "organization_id": "org-1",
            "unit_id": "unit-1",
            "status": "confirmed",
            "check_in_date": "2026-06-10",
            "check_out_date": "2026-06-14",
        }

        def get_row_side_effect(table: str, row_id: str):
            del row_id
            if table == "units":
                return {
                    "id": "unit-1",
                    "property_id": "property-1",
                    "check_in_time": "14:00:00",
                    "check_out_time": "10:00:00",
                }
            if table == "organizations":
                return {"id": "org-1", "timezone": "UTC"}
            return {}

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
                return []
            if table == "task_items":
                return []
            return []

        def create_row_side_effect(table: str, payload: dict):
            if table == "tasks":
                row = {"id": "task-check-in", **payload}
                created_tasks.append(row)
                return row
            if table == "task_items":
                row = {"id": f"item-{len(created_items) + 1}", **payload}
                created_items.append(row)
                return row
            return {"id": "row-1", **payload}

        mock_get_row.side_effect = get_row_side_effect
        mock_list_rows.side_effect = list_rows_side_effect
        mock_create_row.side_effect = create_row_side_effect

        _sync_turnover_tasks_for_status(reservation, actor_user_id="operator-1")

        self.assertEqual(len(created_tasks), 1)
        task = created_tasks[0]
        self.assertEqual(task["type"], "check_in")
        self.assertEqual(task["priority"], "high")
        self.assertEqual(task["status"], "todo")
        self.assertEqual(task["due_at"], "2026-06-10T14:00:00+00:00")
        self.assertEqual(task["sla_due_at"], "2026-06-10T14:00:00+00:00")
        self.assertEqual(task["created_by_user_id"], "operator-1")
        self.assertEqual(len(created_items), 4)

    @patch("app.api.routers.reservations.create_row")
    @patch("app.api.routers.reservations.list_rows")
    @patch("app.api.routers.reservations.get_row")
    def test_checked_out_status_creates_cleaning_and_inspection_tasks(
        self,
        mock_get_row,
        mock_list_rows,
        mock_create_row,
    ):
        created_tasks: list[dict] = []
        created_items: list[dict] = []

        reservation = {
            "id": "reservation-2",
            "organization_id": "org-1",
            "unit_id": "unit-9",
            "status": "checked_out",
            "check_in_date": "2026-07-10",
            "check_out_date": "2026-07-16",
        }

        def get_row_side_effect(table: str, row_id: str):
            del row_id
            if table == "units":
                return {
                    "id": "unit-9",
                    "property_id": "property-9",
                    "check_in_time": "15:00:00",
                    "check_out_time": "10:30:00",
                }
            if table == "organizations":
                return {"id": "org-1", "timezone": "UTC"}
            return {}

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
                return []
            if table == "task_items":
                return []
            return []

        def create_row_side_effect(table: str, payload: dict):
            if table == "tasks":
                row = {"id": f"task-{payload.get('type')}", **payload}
                created_tasks.append(row)
                return row
            if table == "task_items":
                row = {"id": f"item-{len(created_items) + 1}", **payload}
                created_items.append(row)
                return row
            return {"id": "row-1", **payload}

        mock_get_row.side_effect = get_row_side_effect
        mock_list_rows.side_effect = list_rows_side_effect
        mock_create_row.side_effect = create_row_side_effect

        _sync_turnover_tasks_for_status(reservation, actor_user_id="operator-2")

        self.assertEqual(len(created_tasks), 2)
        by_type = {task["type"]: task for task in created_tasks}
        self.assertEqual(set(by_type.keys()), {"cleaning", "inspection"})
        self.assertEqual(by_type["cleaning"]["due_at"], "2026-07-16T10:30:00+00:00")
        self.assertEqual(by_type["inspection"]["due_at"], "2026-07-16T10:30:00+00:00")
        self.assertEqual(len(created_items), 8)

    @patch("app.api.routers.reservations.update_row")
    @patch("app.api.routers.reservations.list_rows")
    def test_cancelled_status_cancels_open_auto_turnover_tasks(
        self,
        mock_list_rows,
        mock_update_row,
    ):
        reservation = {
            "id": "reservation-3",
            "organization_id": "org-1",
            "unit_id": "unit-2",
            "status": "cancelled",
            "check_in_date": "2026-08-10",
            "check_out_date": "2026-08-15",
        }

        mock_list_rows.return_value = [
            {"id": "task-cleaning", "type": "cleaning", "status": "todo"},
            {"id": "task-check-in", "type": "check_in", "status": "in_progress"},
            {"id": "task-maintenance", "type": "maintenance", "status": "todo"},
            {"id": "task-check-out", "type": "check_out", "status": "done"},
        ]
        mock_update_row.side_effect = lambda table, row_id, payload: {
            "id": row_id,
            **payload,
        }

        _sync_turnover_tasks_for_status(reservation, actor_user_id="operator-9")

        cancelled_ids = {call.args[1] for call in mock_update_row.call_args_list}
        self.assertEqual(cancelled_ids, {"task-cleaning", "task-check-in"})
        for call in mock_update_row.call_args_list:
            self.assertEqual(call.args[0], "tasks")
            self.assertEqual(call.args[2]["status"], "cancelled")


if __name__ == "__main__":
    unittest.main()
