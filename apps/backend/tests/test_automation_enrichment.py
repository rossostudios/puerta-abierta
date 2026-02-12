import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.services.enrichment import enrich_reservations, enrich_tasks


class AutomationEnrichmentTest(unittest.TestCase):
    @patch("app.services.enrichment.list_rows")
    def test_enrich_tasks_sets_auto_generated_metadata(self, mock_list_rows):
        now = datetime.now(timezone.utc)
        reservation_created = (now - timedelta(minutes=1)).isoformat()
        task_created = now.isoformat()

        tasks = [
            {
                "id": "task-1",
                "organization_id": "org-1",
                "reservation_id": "reservation-1",
                "type": "check_in",
                "status": "todo",
                "created_at": task_created,
            },
            {
                "id": "task-2",
                "organization_id": "org-1",
                "reservation_id": None,
                "type": "custom",
                "status": "todo",
                "created_at": task_created,
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
            if table == "reservations":
                return [
                    {
                        "id": "reservation-1",
                        "organization_id": "org-1",
                        "status": "confirmed",
                        "created_at": reservation_created,
                    }
                ]
            return []

        mock_list_rows.side_effect = list_rows_side_effect

        enriched = enrich_tasks(tasks, "org-1")
        self.assertEqual(enriched[0]["automation_source"], "reservation_create")
        self.assertTrue(enriched[0]["auto_generated"])
        self.assertIsNone(enriched[1]["automation_source"])
        self.assertFalse(enriched[1]["auto_generated"])

    @patch("app.services.enrichment.list_rows")
    def test_enrich_reservations_sets_auto_generated_counters(self, mock_list_rows):
        now = datetime.now(timezone.utc)
        reservation_created = (now - timedelta(minutes=1)).isoformat()
        task_created = now.isoformat()

        reservations = [
            {
                "id": "reservation-1",
                "organization_id": "org-1",
                "status": "confirmed",
                "created_at": reservation_created,
            }
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
                return [
                    {
                        "id": "task-1",
                        "organization_id": "org-1",
                        "reservation_id": "reservation-1",
                        "type": "check_in",
                        "status": "todo",
                        "created_at": task_created,
                    }
                ]
            return []

        mock_list_rows.side_effect = list_rows_side_effect

        enriched = enrich_reservations(reservations, "org-1")
        row = enriched[0]
        self.assertEqual(row["auto_generated_task_count"], 1)
        self.assertTrue(row["has_auto_generated_tasks"])
        self.assertEqual(row["automation_source"], "reservation_create")


if __name__ == "__main__":
    unittest.main()
