from collections.abc import Iterable
from typing import Any, Optional

from fastapi import HTTPException

from app.core.config import settings
from app.db.supabase import get_supabase_client


def _handle_supabase_error(exc: Exception) -> HTTPException:
    if settings.is_production:
        return HTTPException(status_code=502, detail="Supabase request failed.")
    return HTTPException(status_code=502, detail=f"Supabase request failed: {exc}")


def list_rows(
    table: str,
    filters: Optional[dict[str, Any]] = None,
    limit: int = 50,
    offset: int = 0,
    order_by: str = "created_at",
    ascending: bool = False,
) -> list[dict[str, Any]]:
    try:
        client = get_supabase_client()
        query = client.table(table).select("*")
        for key, value in (filters or {}).items():
            if value is not None:
                if isinstance(value, (list, tuple, set)):
                    query = query.in_(key, list(value))
                else:
                    query = query.eq(key, value)
        query = query.range(offset, offset + limit - 1)
        if order_by:
            query = query.order(order_by, desc=not ascending)
        response = query.execute()
        return response.data or []
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc


def get_row(table: str, row_id: str, id_field: str = "id") -> dict[str, Any]:
    try:
        client = get_supabase_client()
        response = client.table(table).select("*").eq(id_field, row_id).limit(1).execute()
        data = response.data or []
        if not data:
            raise HTTPException(status_code=404, detail=f"{table} record not found.")
        return data[0]
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc


def create_row(table: str, payload: dict[str, Any]) -> dict[str, Any]:
    try:
        client = get_supabase_client()
        response = client.table(table).insert(payload).execute()
        data = response.data or []
        if not data:
            raise HTTPException(status_code=500, detail=f"Could not create {table} record.")
        return data[0]
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc


def update_row(table: str, row_id: str, payload: dict[str, Any], id_field: str = "id") -> dict[str, Any]:
    if not payload:
        raise HTTPException(status_code=400, detail="No fields to update.")
    try:
        client = get_supabase_client()
        response = client.table(table).update(payload).eq(id_field, row_id).execute()
        data = response.data or []
        if not data:
            raise HTTPException(status_code=404, detail=f"{table} record not found.")
        return data[0]
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc


def delete_row(table: str, row_id: str, id_field: str = "id") -> dict[str, Any]:
    """Delete a row and return the previous record.

    Supabase/PostgREST DELETE responses are configurable; to keep this stable we
    read first, then delete.
    """

    existing = get_row(table, row_id, id_field=id_field)
    try:
        client = get_supabase_client()
        client.table(table).delete().eq(id_field, row_id).execute()
        return existing
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc


def date_overlap(start: str, end: str, periods: Iterable[dict[str, str]]) -> bool:
    # Start/end are ISO dates. Overlap check is inclusive-exclusive semantics.
    return any(not (end <= period["from"] or start >= period["to"]) for period in periods)
