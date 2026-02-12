from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException

from app.core.config import settings
from app.db.supabase import get_supabase_client
from app.services.ai_agent import run_ai_agent_chat

_MAX_CHAT_LIMIT = 100
_MAX_MESSAGE_LIMIT = 300
_CONTEXT_WINDOW = 20


def _handle_supabase_error(exc: Exception) -> HTTPException:
    if settings.is_production:
        return HTTPException(status_code=502, detail="Supabase request failed.")
    return HTTPException(status_code=502, detail=f"Supabase request failed: {exc}")


def _coerce_limit(value: Any, *, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(minimum, min(parsed, maximum))


def _trim_preview(value: str, max_chars: int = 120) -> str:
    normalized = " ".join(value.split())
    if len(normalized) <= max_chars:
        return normalized
    return f"{normalized[: max_chars - 1].rstrip()}…"


def _clean_title(value: Optional[str], fallback: str) -> str:
    candidate = (value or "").strip()
    if not candidate:
        return fallback
    if len(candidate) > 180:
        return candidate[:180].rstrip()
    return candidate


def _agent_allowed_tools(agent_row: dict[str, Any]) -> list[str] | None:
    raw = agent_row.get("allowed_tools")
    if not isinstance(raw, list):
        return None

    tools: list[str] = []
    for item in raw:
        tool = str(item or "").strip()
        if tool and tool not in tools:
            tools.append(tool)
    return tools or None


def _get_agent_by_slug(slug: str) -> dict[str, Any]:
    value = slug.strip()
    if not value:
        raise HTTPException(status_code=400, detail="agent_slug is required.")

    client = get_supabase_client()
    try:
        response = (
            client.table("ai_agents")
            .select("*")
            .eq("slug", value)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail=f"AI agent '{value}' was not found.")

    return rows[0]


def _get_agent_by_id(agent_id: str) -> dict[str, Any]:
    client = get_supabase_client()
    try:
        response = (
            client.table("ai_agents")
            .select("*")
            .eq("id", agent_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="AI agent was not found.")

    return rows[0]


def _ensure_chat_owner(*, chat_id: str, org_id: str, user_id: str) -> dict[str, Any]:
    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chats")
            .select("*")
            .eq("id", chat_id)
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Chat not found.")

    return rows[0]


def _latest_preview_for_chat(*, chat_id: str, org_id: str, user_id: str) -> Optional[str]:
    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chat_messages")
            .select("content")
            .eq("chat_id", chat_id)
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        return None

    content = str(rows[0].get("content") or "").strip()
    if not content:
        return None
    return _trim_preview(content)


def _serialize_chat_summary(
    *,
    chat: dict[str, Any],
    agent: dict[str, Any],
    latest_message_preview: Optional[str],
) -> dict[str, Any]:
    return {
        "id": chat.get("id"),
        "org_id": chat.get("organization_id"),
        "agent_id": agent.get("id"),
        "agent_slug": agent.get("slug"),
        "agent_name": agent.get("name"),
        "agent_icon_key": agent.get("icon_key"),
        "title": chat.get("title"),
        "is_archived": bool(chat.get("is_archived", False)),
        "last_message_at": chat.get("last_message_at") or chat.get("created_at"),
        "created_at": chat.get("created_at"),
        "updated_at": chat.get("updated_at"),
        "latest_message_preview": latest_message_preview,
    }


def list_agents(*, org_id: str) -> list[dict[str, Any]]:
    # org_id is intentionally accepted to keep interface consistent and future-proof.
    if not org_id:
        raise HTTPException(status_code=400, detail="org_id is required.")

    client = get_supabase_client()
    try:
        response = (
            client.table("ai_agents")
            .select("id,slug,name,description,icon_key,is_active")
            .eq("is_active", True)
            .order("name", desc=False)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    return response.data or []


def list_chats(
    *,
    org_id: str,
    user_id: str,
    archived: bool,
    limit: int,
) -> list[dict[str, Any]]:
    bounded_limit = _coerce_limit(
        limit,
        default=30,
        minimum=1,
        maximum=_MAX_CHAT_LIMIT,
    )

    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chats")
            .select("*")
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .eq("is_archived", archived)
            .order("last_message_at", desc=True)
            .range(0, bounded_limit - 1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    chats = response.data or []
    if not chats:
        return []

    agent_ids = [str(chat.get("agent_id")) for chat in chats if chat.get("agent_id")]

    agents: dict[str, dict[str, Any]] = {}
    if agent_ids:
        try:
            agent_response = (
                client.table("ai_agents")
                .select("id,slug,name,description,icon_key,is_active")
                .in_("id", agent_ids)
                .execute()
            )
        except Exception as exc:  # pragma: no cover - framework guard
            raise _handle_supabase_error(exc) from exc
        agents = {
            str(row.get("id")): row
            for row in (agent_response.data or [])
            if row.get("id")
        }

    summaries: list[dict[str, Any]] = []
    for chat in chats:
        agent_id = str(chat.get("agent_id") or "")
        agent = agents.get(agent_id)
        if not agent:
            continue
        preview = _latest_preview_for_chat(
            chat_id=str(chat.get("id")),
            org_id=org_id,
            user_id=user_id,
        )
        summaries.append(
            _serialize_chat_summary(
                chat=chat,
                agent=agent,
                latest_message_preview=preview,
            )
        )

    return summaries


def create_chat(
    *,
    org_id: str,
    user_id: str,
    agent_slug: str,
    title: Optional[str] = None,
) -> dict[str, Any]:
    agent = _get_agent_by_slug(agent_slug)
    chat_title = _clean_title(title, fallback=str(agent.get("name") or "New chat"))

    client = get_supabase_client()
    payload = {
        "organization_id": org_id,
        "created_by_user_id": user_id,
        "agent_id": agent["id"],
        "title": chat_title,
        "is_archived": False,
    }

    try:
        response = client.table("ai_chats").insert(payload).execute()
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Could not create chat.")

    chat = rows[0]
    return _serialize_chat_summary(chat=chat, agent=agent, latest_message_preview=None)


def get_chat(*, chat_id: str, org_id: str, user_id: str) -> dict[str, Any]:
    chat = _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    agent = _get_agent_by_id(str(chat.get("agent_id")))
    preview = _latest_preview_for_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)
    return _serialize_chat_summary(chat=chat, agent=agent, latest_message_preview=preview)


def list_chat_messages(
    *,
    chat_id: str,
    org_id: str,
    user_id: str,
    limit: int,
) -> list[dict[str, Any]]:
    _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    bounded_limit = _coerce_limit(
        limit,
        default=80,
        minimum=1,
        maximum=_MAX_MESSAGE_LIMIT,
    )

    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chat_messages")
            .select("*")
            .eq("chat_id", chat_id)
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .order("created_at", desc=True)
            .range(0, bounded_limit - 1)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    rows.reverse()

    return [
        {
            "id": row.get("id"),
            "chat_id": row.get("chat_id"),
            "org_id": row.get("organization_id"),
            "role": row.get("role"),
            "content": row.get("content"),
            "tool_trace": row.get("tool_trace"),
            "model_used": row.get("model_used"),
            "fallback_used": bool(row.get("fallback_used", False)),
            "created_at": row.get("created_at"),
        }
        for row in rows
    ]


def _collect_context_messages(
    *,
    chat_id: str,
    org_id: str,
    user_id: str,
    limit: int = _CONTEXT_WINDOW,
) -> list[dict[str, str]]:
    messages = list_chat_messages(
        chat_id=chat_id,
        org_id=org_id,
        user_id=user_id,
        limit=limit,
    )
    context: list[dict[str, str]] = []
    for message in messages:
        role = str(message.get("role") or "").strip().lower()
        content = str(message.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            context.append({"role": role, "content": content})
    return context[-limit:]


def send_chat_message(
    *,
    chat_id: str,
    org_id: str,
    user_id: str,
    role: str,
    message: str,
    allow_mutations: bool,
    confirm_write: bool,
) -> dict[str, Any]:
    chat = _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    agent = _get_agent_by_id(str(chat.get("agent_id")))

    trimmed_message = message.strip()
    if not trimmed_message:
        raise HTTPException(status_code=400, detail="message is required.")

    conversation = _collect_context_messages(chat_id=chat_id, org_id=org_id, user_id=user_id)

    client = get_supabase_client()
    user_payload = {
        "chat_id": chat_id,
        "organization_id": org_id,
        "role": "user",
        "content": trimmed_message,
        "created_by_user_id": user_id,
    }

    try:
        user_insert = client.table("ai_chat_messages").insert(user_payload).execute()
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    user_rows = user_insert.data or []
    if not user_rows:
        raise HTTPException(status_code=500, detail="Could not persist user message.")

    agent_result = run_ai_agent_chat(
        org_id=org_id,
        user_id=user_id,
        role=role,
        message=trimmed_message,
        conversation=conversation,
        allow_mutations=allow_mutations,
        confirm_write=confirm_write,
        agent_name=str(agent.get("name") or "Operations Copilot"),
        agent_prompt=str(agent.get("system_prompt") or "").strip() or None,
        allowed_tools=_agent_allowed_tools(agent),
    )

    reply = str(agent_result.get("reply") or "").strip() or "No response generated."

    assistant_payload: dict[str, Any] = {
        "chat_id": chat_id,
        "organization_id": org_id,
        "role": "assistant",
        "content": reply,
        "created_by_user_id": user_id,
        "fallback_used": bool(agent_result.get("fallback_used", False)),
    }

    tool_trace = agent_result.get("tool_trace")
    if isinstance(tool_trace, list):
        assistant_payload["tool_trace"] = tool_trace

    model_used = agent_result.get("model_used")
    if isinstance(model_used, str) and model_used.strip():
        assistant_payload["model_used"] = model_used.strip()

    try:
        assistant_insert = client.table("ai_chat_messages").insert(assistant_payload).execute()
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    assistant_rows = assistant_insert.data or []
    if not assistant_rows:
        raise HTTPException(status_code=500, detail="Could not persist assistant message.")

    title = str(chat.get("title") or "").strip()
    if not title or title == str(agent.get("name") or "").strip():
        generated_title = _clean_title(trimmed_message, fallback=title or "New chat")
    else:
        generated_title = title

    update_payload = {
        "last_message_at": assistant_rows[0].get("created_at"),
        "title": generated_title,
    }

    try:
        client.table("ai_chats").update(update_payload).eq("id", chat_id).execute()
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    summary = get_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)

    return {
        "chat": summary,
        "user_message": {
            "id": user_rows[0].get("id"),
            "chat_id": user_rows[0].get("chat_id"),
            "org_id": user_rows[0].get("organization_id"),
            "role": user_rows[0].get("role"),
            "content": user_rows[0].get("content"),
            "tool_trace": user_rows[0].get("tool_trace"),
            "model_used": user_rows[0].get("model_used"),
            "fallback_used": bool(user_rows[0].get("fallback_used", False)),
            "created_at": user_rows[0].get("created_at"),
        },
        "assistant_message": {
            "id": assistant_rows[0].get("id"),
            "chat_id": assistant_rows[0].get("chat_id"),
            "org_id": assistant_rows[0].get("organization_id"),
            "role": assistant_rows[0].get("role"),
            "content": assistant_rows[0].get("content"),
            "tool_trace": assistant_rows[0].get("tool_trace"),
            "model_used": assistant_rows[0].get("model_used"),
            "fallback_used": bool(assistant_rows[0].get("fallback_used", False)),
            "created_at": assistant_rows[0].get("created_at"),
        },
        "reply": reply,
        "tool_trace": tool_trace if isinstance(tool_trace, list) else [],
        "mutations_enabled": bool(agent_result.get("mutations_enabled", False)),
        "model_used": agent_result.get("model_used"),
        "fallback_used": bool(agent_result.get("fallback_used", False)),
    }


def archive_chat(*, chat_id: str, org_id: str, user_id: str) -> dict[str, Any]:
    _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chats")
            .update({"is_archived": True})
            .eq("id", chat_id)
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Chat not found.")

    return rows[0]


def restore_chat(*, chat_id: str, org_id: str, user_id: str) -> dict[str, Any]:
    _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    client = get_supabase_client()
    try:
        response = (
            client.table("ai_chats")
            .update({"is_archived": False})
            .eq("id", chat_id)
            .eq("organization_id", org_id)
            .eq("created_by_user_id", user_id)
            .execute()
        )
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc

    rows = response.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Chat not found.")

    return rows[0]


def delete_chat(*, chat_id: str, org_id: str, user_id: str) -> dict[str, Any]:
    chat = _ensure_chat_owner(chat_id=chat_id, org_id=org_id, user_id=user_id)
    client = get_supabase_client()
    try:
        client.table("ai_chats").delete().eq("id", chat_id).eq("organization_id", org_id).eq(
            "created_by_user_id", user_id
        ).execute()
    except Exception as exc:  # pragma: no cover - framework guard
        raise _handle_supabase_error(exc) from exc
    return chat
