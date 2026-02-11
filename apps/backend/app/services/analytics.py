from datetime import datetime, timezone
from typing import Any, Optional

from app.db.supabase import get_supabase_client


def write_analytics_event(
    organization_id: Optional[str],
    event_type: str,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    if not organization_id or not event_type:
        return

    event_payload = payload or {}

    try:
        client = get_supabase_client()
        now_iso = datetime.now(timezone.utc).isoformat()
        client.table("integration_events").insert(
            {
                "organization_id": organization_id,
                "provider": "analytics",
                "event_type": event_type,
                "payload": event_payload,
                "status": "processed",
                "processed_at": now_iso,
            }
        ).execute()
    except Exception:
        return
