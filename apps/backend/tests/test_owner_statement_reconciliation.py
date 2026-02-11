import unittest
from unittest.mock import patch

from app.api.routers.owner_statements import create_owner_statement
from app.schemas.domain import CreateOwnerStatementInput


class OwnerStatementReconciliationTest(unittest.TestCase):
    def _payload(self) -> CreateOwnerStatementInput:
        return CreateOwnerStatementInput(
            organization_id="org-1",
            period_start="2026-05-01",
            period_end="2026-05-31",
            currency="PYG",
        )

    def _list_rows_side_effect(self, datasets: dict[str, list[dict]]):
        def side_effect(
            table: str,
            filters=None,
            limit: int = 50,
            offset: int = 0,
            order_by: str = "created_at",
            ascending: bool = False,
        ):
            del filters, limit, offset, order_by, ascending
            rows = datasets.get(table, [])
            return [dict(row) for row in rows]

        return side_effect

    @patch("app.api.routers.owner_statements.write_audit_log")
    @patch("app.api.routers.owner_statements.create_row")
    @patch("app.api.routers.owner_statements.list_rows")
    @patch("app.api.routers.owner_statements.assert_org_role")
    def test_statement_reconciles_paid_collections_and_service_fees(
        self,
        mock_assert_org_role,
        mock_list_rows,
        mock_create_row,
        mock_write_audit_log,
    ):
        del mock_assert_org_role, mock_write_audit_log

        datasets = {
            "reservations": [],
            "expenses": [],
            "leases": [
                {
                    "id": "lease-1",
                    "organization_id": "org-1",
                    "platform_fee": 1200,
                }
            ],
            "lease_charges": [
                {
                    "id": "charge-1",
                    "lease_id": "lease-1",
                    "charge_date": "2026-05-05",
                    "charge_type": "service_fee_flat",
                    "amount": 500,
                    "currency": "PYG",
                },
                {
                    "id": "charge-2",
                    "lease_id": "lease-1",
                    "charge_date": "2026-05-08",
                    "charge_type": "monthly_rent",
                    "amount": 2000,
                    "currency": "PYG",
                },
                {
                    "id": "charge-3",
                    "lease_id": "lease-1",
                    "charge_date": "2026-05-15",
                    "charge_type": "admin_fee",
                    "amount": 80,
                    "currency": "PYG",
                },
            ],
            "collection_records": [
                {
                    "id": "collection-1",
                    "lease_id": "lease-1",
                    "status": "paid",
                    "due_date": "2026-05-02",
                    "paid_at": "2026-05-03T10:00:00+00:00",
                    "amount": 3000,
                    "currency": "PYG",
                },
                {
                    "id": "collection-2",
                    "lease_id": "lease-1",
                    "status": "paid",
                    "due_date": "2026-05-15",
                    "paid_at": "2026-05-16T10:00:00+00:00",
                    "amount": 3200,
                    "currency": "PYG",
                },
                {
                    "id": "collection-3",
                    "lease_id": "lease-1",
                    "status": "scheduled",
                    "due_date": "2026-05-20",
                    "amount": 3200,
                    "currency": "PYG",
                },
                {
                    "id": "collection-4",
                    "lease_id": "lease-1",
                    "status": "paid",
                    "due_date": "2026-04-25",
                    "paid_at": "2026-04-25T10:00:00+00:00",
                    "amount": 1111,
                    "currency": "PYG",
                },
            ],
        }

        mock_list_rows.side_effect = self._list_rows_side_effect(datasets)
        mock_create_row.side_effect = lambda table, payload: {
            "id": "statement-1",
            **payload,
        }

        result = create_owner_statement(self._payload(), user_id="user-1")

        self.assertEqual(result["id"], "statement-1")
        self.assertEqual(result["gross_revenue"], 0.0)
        self.assertEqual(result["lease_collections"], 6200.0)
        self.assertEqual(result["service_fees"], 580.0)
        self.assertEqual(result["collection_fees"], 1200.0)
        self.assertEqual(result["platform_fees"], 0.0)
        self.assertEqual(result["net_payout"], 4420.0)
        self.assertEqual(result["reconciliation"]["computed_net_payout"], 4420.0)
        self.assertEqual(result["reconciliation"]["stored_vs_computed_diff"], 0.0)
        buckets = {item.get("bucket") for item in result["line_items"]}
        self.assertIn("lease_collections", buckets)
        self.assertIn("service_fees", buckets)
        self.assertIn("collection_fees", buckets)

    @patch("app.api.routers.owner_statements.write_audit_log")
    @patch("app.api.routers.owner_statements.create_row")
    @patch("app.api.routers.owner_statements.list_rows")
    @patch("app.api.routers.owner_statements.assert_org_role")
    def test_collection_fee_counts_once_per_paid_lease(
        self,
        mock_assert_org_role,
        mock_list_rows,
        mock_create_row,
        mock_write_audit_log,
    ):
        del mock_assert_org_role, mock_write_audit_log

        datasets = {
            "reservations": [],
            "expenses": [],
            "leases": [
                {
                    "id": "lease-1",
                    "organization_id": "org-1",
                    "platform_fee": 1000,
                },
                {
                    "id": "lease-2",
                    "organization_id": "org-1",
                    "platform_fee": 700,
                },
            ],
            "lease_charges": [
                {
                    "id": "charge-1",
                    "lease_id": "lease-1",
                    "charge_date": "2026-05-04",
                    "charge_type": "service_fee_flat",
                    "amount": 150,
                    "currency": "PYG",
                },
                {
                    "id": "charge-2",
                    "lease_id": "lease-2",
                    "charge_date": "2026-05-10",
                    "charge_type": "admin_fee",
                    "amount": 90,
                    "currency": "PYG",
                },
                {
                    "id": "charge-3",
                    "lease_id": "lease-2",
                    "charge_date": "2026-05-10",
                    "charge_type": "monthly_rent",
                    "amount": 999,
                    "currency": "PYG",
                },
            ],
            "collection_records": [
                {
                    "id": "collection-1",
                    "lease_id": "lease-1",
                    "status": "paid",
                    "due_date": "2026-05-03",
                    "paid_at": "2026-05-03T10:00:00+00:00",
                    "amount": 1800,
                    "currency": "PYG",
                },
                {
                    "id": "collection-2",
                    "lease_id": "lease-1",
                    "status": "paid",
                    "due_date": "2026-05-20",
                    "paid_at": "2026-05-20T10:00:00+00:00",
                    "amount": 2200,
                    "currency": "PYG",
                },
                {
                    "id": "collection-3",
                    "lease_id": "lease-2",
                    "status": "paid",
                    "due_date": "2026-05-21",
                    "paid_at": "2026-05-21T10:00:00+00:00",
                    "amount": 1600,
                    "currency": "PYG",
                },
            ],
        }

        mock_list_rows.side_effect = self._list_rows_side_effect(datasets)
        mock_create_row.side_effect = lambda table, payload: {
            "id": "statement-2",
            **payload,
        }

        result = create_owner_statement(self._payload(), user_id="user-2")

        self.assertEqual(result["lease_collections"], 5600.0)
        self.assertEqual(result["service_fees"], 240.0)
        self.assertEqual(result["collection_fees"], 1700.0)
        self.assertEqual(result["net_payout"], 3660.0)
        self.assertEqual(result["reconciliation"]["computed_net_payout"], 3660.0)
        self.assertEqual(result["reconciliation"]["stored_vs_computed_diff"], 0.0)


if __name__ == "__main__":
    unittest.main()
