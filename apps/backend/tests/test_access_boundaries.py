import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routers.collections import (
    COLLECTION_EDIT_ROLES,
    create_collection,
    mark_collection_paid,
)
from app.api.routers.marketplace import (
    list_public_marketplace_listings,
    submit_public_marketplace_application,
)
from app.api.routers.reports import transparency_summary_report
from app.schemas.domain import (
    CreateCollectionInput,
    MarkCollectionPaidInput,
    PublicMarketplaceApplicationInput,
)


class AccessBoundaryTest(unittest.TestCase):
    @patch("app.api.routers.marketplace.write_analytics_event")
    @patch("app.api.routers.marketplace.create_row")
    @patch("app.api.routers.marketplace.get_row")
    @patch("app.api.routers.marketplace.ensure_marketplace_public_enabled")
    def test_public_application_ignores_client_org_context(
        self,
        mock_ensure_public_enabled,
        mock_get_row,
        mock_create_row,
        mock_write_analytics,
    ):
        del mock_ensure_public_enabled, mock_write_analytics

        mock_get_row.return_value = {
            "id": "listing-1",
            "organization_id": "org-safe",
            "public_slug": "asuncion-downtown",
            "is_published": True,
        }

        captured_payloads: list[tuple[str, dict]] = []

        def create_row_side_effect(table: str, payload: dict):
            captured_payloads.append((table, dict(payload)))
            if table == "application_submissions":
                return {
                    "id": "application-1",
                    "status": "new",
                    "marketplace_listing_id": payload.get("marketplace_listing_id"),
                    "source": payload.get("source"),
                }
            return {"id": "event-1", **payload}

        mock_create_row.side_effect = create_row_side_effect

        payload = PublicMarketplaceApplicationInput(
            org_id="org-malicious",
            marketplace_listing_id="listing-1",
            full_name="Tenant One",
            email="tenant@example.com",
            source="marketplace",
        )

        result = submit_public_marketplace_application(payload)

        self.assertEqual(result["id"], "application-1")
        self.assertEqual(result["marketplace_listing_id"], "listing-1")

        application_payload = captured_payloads[0][1]
        self.assertEqual(application_payload["organization_id"], "org-safe")
        self.assertNotIn("org_id", application_payload)
        self.assertEqual(application_payload["marketplace_listing_id"], "listing-1")

    @patch("app.api.routers.marketplace._attach_fee_lines")
    @patch("app.api.routers.marketplace.list_rows")
    @patch("app.api.routers.marketplace.ensure_marketplace_public_enabled")
    def test_public_marketplace_listing_endpoint_is_unauthenticated(
        self,
        mock_ensure_public_enabled,
        mock_list_rows,
        mock_attach_fee_lines,
    ):
        del mock_ensure_public_enabled

        rows = [
            {
                "id": "listing-1",
                "organization_id": "org-1",
                "public_slug": "demo",
                "title": "Demo Listing",
                "is_published": True,
            }
        ]
        mock_list_rows.return_value = rows
        mock_attach_fee_lines.return_value = rows

        result = list_public_marketplace_listings(
            city=None,
            q=None,
            org_id=None,
            limit=60,
        )

        args, _kwargs = mock_list_rows.call_args
        self.assertEqual(args[0], "marketplace_listings")
        self.assertEqual(args[1], {"is_published": True})
        self.assertEqual(result["data"][0]["id"], "listing-1")

    @patch("app.api.routers.collections.get_row")
    @patch("app.api.routers.collections.assert_org_role")
    @patch("app.api.routers.collections.ensure_lease_collections_enabled")
    def test_create_collection_rejects_cross_org_lease(
        self,
        mock_ensure_collections_enabled,
        mock_assert_org_role,
        mock_get_row,
    ):
        del mock_ensure_collections_enabled

        mock_get_row.return_value = {
            "id": "lease-1",
            "organization_id": "org-2",
        }

        payload = CreateCollectionInput(
            organization_id="org-1",
            lease_id="lease-1",
            due_date="2026-06-01",
            amount=1000,
            currency="PYG",
        )

        with self.assertRaises(HTTPException) as ctx:
            create_collection(payload, user_id="user-1")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("does not belong", str(ctx.exception.detail))
        mock_assert_org_role.assert_called_once_with(
            "user-1",
            "org-1",
            COLLECTION_EDIT_ROLES,
        )

    @patch("app.api.routers.collections.write_analytics_event")
    @patch("app.api.routers.collections.write_audit_log")
    @patch("app.api.routers.collections._refresh_lease_status")
    @patch("app.api.routers.collections.list_rows")
    @patch("app.api.routers.collections.update_row")
    @patch("app.api.routers.collections.assert_org_role")
    @patch("app.api.routers.collections.get_row")
    @patch("app.api.routers.collections.ensure_lease_collections_enabled")
    def test_mark_collection_paid_uses_record_org_for_auth(
        self,
        mock_ensure_collections_enabled,
        mock_get_row,
        mock_assert_org_role,
        mock_update_row,
        mock_list_rows,
        mock_refresh_lease_status,
        mock_write_audit_log,
        mock_write_analytics_event,
    ):
        del mock_ensure_collections_enabled, mock_write_audit_log, mock_write_analytics_event

        record = {
            "id": "collection-1",
            "organization_id": "org-collections",
            "lease_id": "lease-1",
            "lease_charge_id": "charge-1",
            "due_date": "2026-06-01",
            "status": "scheduled",
            "amount": 4500000,
            "currency": "PYG",
        }
        mock_get_row.return_value = record

        def update_row_side_effect(table: str, row_id: str, payload: dict, id_field: str = "id"):
            del row_id, payload, id_field
            if table == "collection_records":
                return {
                    **record,
                    "status": "paid",
                    "paid_at": "2026-06-01T10:00:00+00:00",
                }
            if table == "lease_charges":
                return {"id": "charge-1", "status": "paid"}
            return {}

        mock_update_row.side_effect = update_row_side_effect
        mock_list_rows.return_value = []

        result = mark_collection_paid(
            "collection-1",
            MarkCollectionPaidInput(),
            user_id="user-1",
        )

        mock_assert_org_role.assert_called_once_with(
            "user-1",
            "org-collections",
            COLLECTION_EDIT_ROLES,
        )
        mock_refresh_lease_status.assert_called_once_with("lease-1")
        self.assertEqual(result["status"], "paid")

    @patch("app.api.routers.reports.missing_required_fee_types")
    @patch("app.api.routers.reports.list_rows")
    @patch("app.api.routers.reports.assert_org_member")
    def test_transparency_summary_enforces_membership_and_org_scope(
        self,
        mock_assert_org_member,
        mock_list_rows,
        mock_missing_required_fee_types,
    ):
        mock_missing_required_fee_types.return_value = []

        def list_rows_side_effect(
            table: str,
            filters=None,
            limit: int = 50,
            offset: int = 0,
            order_by: str = "created_at",
            ascending: bool = False,
        ):
            del limit, offset, order_by, ascending
            if table == "marketplace_listings":
                self.assertEqual(filters, {"organization_id": "org-1"})
                return [
                    {"id": "listing-1", "organization_id": "org-1", "is_published": True},
                    {"id": "listing-2", "organization_id": "org-1", "is_published": False},
                ]
            if table == "marketplace_listing_fee_lines":
                self.assertEqual(filters, {"marketplace_listing_id": ["listing-1", "listing-2"]})
                return []
            if table == "application_submissions":
                self.assertEqual(filters, {"organization_id": "org-1"})
                return [
                    {
                        "created_at": "2026-05-10T12:00:00+00:00",
                        "status": "qualified",
                        "first_response_at": "2026-05-10T13:00:00+00:00",
                    }
                ]
            if table == "collection_records":
                self.assertEqual(filters, {"organization_id": "org-1"})
                return [
                    {
                        "due_date": "2026-05-20",
                        "status": "paid",
                        "amount": 1200000,
                        "currency": "PYG",
                    }
                ]
            return []

        mock_list_rows.side_effect = list_rows_side_effect

        result = transparency_summary_report(
            org_id="org-1",
            from_date="2026-05-01",
            to_date="2026-05-31",
            user_id="user-1",
        )

        mock_assert_org_member.assert_called_once_with("user-1", "org-1")
        self.assertEqual(result["organization_id"], "org-1")
        self.assertEqual(result["published_listings"], 1)
        self.assertEqual(result["transparent_listings"], 1)
        self.assertEqual(result["applications"], 1)
        self.assertEqual(result["qualified_applications"], 1)
        self.assertEqual(result["collections_paid"], 1)


if __name__ == "__main__":
    unittest.main()
