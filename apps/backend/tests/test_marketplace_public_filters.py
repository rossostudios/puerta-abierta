import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.api.routers.marketplace import (
    list_public_marketplace_listings,
    publish_marketplace_listing,
    track_public_marketplace_whatsapp_contact,
)


class MarketplacePublicFiltersTest(unittest.TestCase):
    @patch("app.api.routers.marketplace.assert_org_role")
    @patch("app.api.routers.marketplace.get_row")
    def test_publish_requires_cover_image(self, mock_get_row, mock_assert_org_role):
        del mock_assert_org_role

        mock_get_row.return_value = {
            "id": "listing-1",
            "organization_id": "org-1",
            "cover_image_url": None,
        }

        with self.assertRaises(HTTPException) as captured:
            publish_marketplace_listing("listing-1", user_id="user-1")

        self.assertEqual(captured.exception.status_code, 400)
        self.assertIn("cover_image_url", str(captured.exception.detail))

    @patch("app.api.routers.marketplace.ensure_marketplace_public_enabled")
    @patch("app.api.routers.marketplace._attach_fee_lines")
    @patch("app.api.routers.marketplace.list_rows")
    def test_public_listing_filters_include_specs_and_budget(
        self,
        mock_list_rows,
        mock_attach_fee_lines,
        mock_ensure_marketplace_public_enabled,
    ):
        del mock_ensure_marketplace_public_enabled

        base_rows = [
            {
                "id": "listing-1",
                "organization_id": "org-1",
                "public_slug": "centro-1d",
                "title": "Centro 1D",
                "is_published": True,
                "monthly_recurring_total": 1800000,
                "total_move_in": 3600000,
                "bedrooms": 1,
                "bathrooms": 1,
            },
            {
                "id": "listing-2",
                "organization_id": "org-1",
                "public_slug": "villa-2d",
                "title": "Villa 2D",
                "is_published": True,
                "monthly_recurring_total": 2600000,
                "total_move_in": 5200000,
                "bedrooms": 2,
                "bathrooms": 1.5,
            },
        ]

        mock_list_rows.return_value = base_rows
        mock_attach_fee_lines.return_value = base_rows

        result = list_public_marketplace_listings(
            city=None,
            neighborhood=None,
            q=None,
            min_monthly=2000000,
            max_monthly=None,
            min_move_in=None,
            max_move_in=None,
            min_bedrooms=2,
            min_bathrooms=1,
            org_id="org-1",
            limit=60,
        )

        args, _kwargs = mock_list_rows.call_args
        self.assertEqual(args[0], "marketplace_listings")
        self.assertEqual(args[1], {"is_published": True, "organization_id": "org-1"})

        rows = result["data"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "listing-2")

    @patch("app.api.routers.marketplace.ensure_marketplace_public_enabled")
    @patch("app.api.routers.marketplace.write_analytics_event")
    @patch("app.api.routers.marketplace.list_rows")
    def test_contact_whatsapp_tracks_analytics_event(
        self,
        mock_list_rows,
        mock_write_analytics_event,
        mock_ensure_marketplace_public_enabled,
    ):
        del mock_ensure_marketplace_public_enabled

        mock_list_rows.return_value = [
            {
                "id": "listing-1",
                "organization_id": "org-1",
                "public_slug": "villa-2d",
                "is_published": True,
            }
        ]

        result = track_public_marketplace_whatsapp_contact("villa-2d")

        self.assertTrue(result["ok"])
        self.assertEqual(mock_write_analytics_event.call_count, 1)
        _args, kwargs = mock_write_analytics_event.call_args
        self.assertEqual(kwargs["event_type"], "contact_whatsapp")


if __name__ == "__main__":
    unittest.main()
