from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

from fastapi import HTTPException

from app.core.config import settings
from app.db.supabase import get_supabase_client

_ALLOWED_TABLES: dict[str, dict[str, Any]] = {
    "organizations": {
        "org_column": "id",
        "can_create": False,
        "can_update": True,
        "can_delete": False,
    },
    "organization_invites": {"org_column": "organization_id"},
    "properties": {"org_column": "organization_id"},
    "units": {"org_column": "organization_id"},
    "channels": {"org_column": "organization_id"},
    "listings": {"org_column": "organization_id"},
    "guests": {"org_column": "organization_id"},
    "reservations": {"org_column": "organization_id"},
    "calendar_blocks": {"org_column": "organization_id"},
    "tasks": {"org_column": "organization_id"},
    "expenses": {"org_column": "organization_id"},
    "owner_statements": {"org_column": "organization_id"},
    "pricing_templates": {"org_column": "organization_id"},
    "marketplace_listings": {"org_column": "organization_id"},
    "application_submissions": {"org_column": "organization_id"},
    "application_events": {"org_column": "organization_id"},
    "leases": {"org_column": "organization_id"},
    "lease_charges": {"org_column": "organization_id"},
    "collection_records": {"org_column": "organization_id"},
    "message_templates": {"org_column": "organization_id"},
    "message_logs": {"org_column": "organization_id"},
    "integration_events": {"org_column": "organization_id"},
    "audit_logs": {
        "org_column": "organization_id",
        "can_create": False,
        "can_update": False,
        "can_delete": False,
    },
}

_MUTATION_ROLES = {"owner_admin", "operator", "accountant"}


def list_supported_tables() -> list[str]:
    return sorted(_ALLOWED_TABLES.keys())


def agent_capabilities(role: str, allow_mutations: bool) -> dict[str, Any]:
    role_value = (role or "viewer").strip().lower()
    return {
        "tables": list_supported_tables(),
        "role": role_value,
        "mutations_enabled": _mutations_allowed(role_value, allow_mutations, False),
    }


def run_ai_agent_chat(
    *,
    org_id: str,
    user_id: str,
    role: str,
    message: str,
    conversation: list[dict[str, str]],
    allow_mutations: bool,
    confirm_write: bool = False,
    agent_name: str = "Operations Copilot",
    agent_prompt: Optional[str] = None,
    allowed_tools: Optional[list[str]] = None,
) -> dict[str, Any]:
    if not settings.ai_agent_enabled:
        raise HTTPException(status_code=503, detail="AI agent is disabled in this environment.")

    role_value = (role or "viewer").strip().lower()
    base_prompt = (
        agent_prompt.strip()
        if isinstance(agent_prompt, str) and agent_prompt.strip()
        else f"You are {agent_name} for Puerta Abierta, a property-management platform in Paraguay."
    )
    system_prompt = (
        f"{base_prompt} "
        "Use tools for all data-backed answers. Keep replies concise and action-oriented. "
        f"Current org_id is {org_id}. Current user role is {role_value}. "
        "Never access data outside this organization. "
        "When a user asks to create/update/delete data, call the matching tool. "
        "If a write tool returns an error, explain why and propose a safe next action."
    )

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
    for item in conversation[-12:]:
        role_name = item.get("role", "").strip().lower()
        content = str(item.get("content", "")).strip()
        if role_name in {"user", "assistant"} and content:
            messages.append({"role": role_name, "content": content[:4000]})
    messages.append({"role": "user", "content": message.strip()[:4000]})

    tool_trace: list[dict[str, Any]] = []
    fallback_used = False
    model_used = ""
    tool_definitions = _tool_definitions(allowed_tools=allowed_tools)

    for _ in range(max(1, settings.ai_agent_max_tool_steps)):
        completion, call_model, call_fallback = _call_openai_chat_completion(
            messages=messages,
            tools=tool_definitions,
        )
        model_used = call_model
        fallback_used = fallback_used or call_fallback
        choice = (completion.get("choices") or [{}])[0]
        assistant_message = choice.get("message") or {}
        assistant_text = _extract_content_text(assistant_message.get("content"))
        tool_calls = assistant_message.get("tool_calls") or []

        if tool_calls:
            messages.append(
                {
                    "role": "assistant",
                    "content": assistant_text or "",
                    "tool_calls": tool_calls,
                }
            )

            for call in tool_calls:
                call_id = str(call.get("id") or "tool-call")
                function_payload = call.get("function") or {}
                tool_name = str(function_payload.get("name") or "").strip()
                raw_arguments = function_payload.get("arguments")

                try:
                    arguments = _parse_tool_arguments(raw_arguments)
                    tool_result = _execute_tool(
                        tool_name,
                        arguments,
                        org_id=org_id,
                        role=role_value,
                        allow_mutations=allow_mutations,
                        confirm_write=confirm_write,
                        allowed_tools=allowed_tools,
                    )
                except HTTPException as exc:
                    tool_result = {"ok": False, "error": str(exc.detail)}
                except Exception as exc:  # pragma: no cover - safety net
                    detail = "Tool execution failed."
                    if not settings.is_production:
                        detail = f"Tool execution failed: {exc}"
                    tool_result = {"ok": False, "error": detail}

                tool_trace.append(
                    {
                        "tool": tool_name,
                        "args": arguments if isinstance(arguments, dict) else {},
                        "ok": bool(tool_result.get("ok")),
                        "preview": _preview_result(tool_result),
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": json.dumps(tool_result, ensure_ascii=False)[:12000],
                    }
                )
            continue

        if assistant_text:
            return {
                "reply": assistant_text,
                "tool_trace": tool_trace,
                "mutations_enabled": _mutations_allowed(role_value, allow_mutations, confirm_write),
                "model_used": model_used,
                "fallback_used": fallback_used,
            }

        break

    final_completion, final_model, final_fallback = _call_openai_chat_completion(
        messages=messages,
        tools=None,
    )
    model_used = final_model or model_used
    fallback_used = fallback_used or final_fallback
    final_choice = (final_completion.get("choices") or [{}])[0]
    final_message = final_choice.get("message") or {}
    final_text = _extract_content_text(final_message.get("content"))

    return {
        "reply": final_text
        or "I completed the tool calls but could not generate a final answer. Please rephrase the request.",
        "tool_trace": tool_trace,
        "mutations_enabled": _mutations_allowed(role_value, allow_mutations, confirm_write),
        "model_used": model_used,
        "fallback_used": fallback_used,
    }


def _tool_definitions(*, allowed_tools: Optional[list[str]] = None) -> list[dict[str, Any]]:
    definitions = [
        {
            "type": "function",
            "function": {
                "name": "list_tables",
                "description": "List database tables that the agent can access.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_org_snapshot",
                "description": "Get high-level counts for leasing and operations tables.",
                "parameters": {"type": "object", "properties": {}},
            },
        },
        {
            "type": "function",
            "function": {
                "name": "list_rows",
                "description": "List rows from a table with optional filters.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "filters": {
                            "type": "object",
                            "description": "Simple filters. Values can be scalar/list or {op, value}.",
                        },
                        "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                        "order_by": {"type": "string"},
                        "ascending": {"type": "boolean"},
                    },
                    "required": ["table"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "get_row",
                "description": "Get one row by id from a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"},
                    },
                    "required": ["table", "row_id"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "create_row",
                "description": "Create one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "payload": {"type": "object"},
                    },
                    "required": ["table", "payload"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "update_row",
                "description": "Update one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "payload": {"type": "object"},
                        "id_field": {"type": "string", "default": "id"},
                    },
                    "required": ["table", "row_id", "payload"],
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "delete_row",
                "description": "Delete one row in a table.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "table": {"type": "string"},
                        "row_id": {"type": "string"},
                        "id_field": {"type": "string", "default": "id"},
                    },
                    "required": ["table", "row_id"],
                },
            },
        },
    ]

    if not allowed_tools:
        return definitions

    allowed = {value.strip() for value in allowed_tools if str(value).strip()}
    if not allowed:
        return definitions

    return [
        definition
        for definition in definitions
        if str((definition.get("function") or {}).get("name") or "").strip() in allowed
    ]


def _execute_tool(
    tool_name: str,
    args: dict[str, Any],
    *,
    org_id: str,
    role: str,
    allow_mutations: bool,
    confirm_write: bool,
    allowed_tools: Optional[list[str]] = None,
) -> dict[str, Any]:
    if allowed_tools:
        allowed = {value.strip() for value in allowed_tools if str(value).strip()}
        if allowed and tool_name not in allowed:
            return {"ok": False, "error": f"Tool '{tool_name}' is not enabled for this agent."}

    if tool_name == "list_tables":
        return {"ok": True, "tables": list_supported_tables()}
    if tool_name == "get_org_snapshot":
        return _tool_get_org_snapshot(org_id=org_id)
    if tool_name == "list_rows":
        return _tool_list_rows(org_id=org_id, args=args)
    if tool_name == "get_row":
        return _tool_get_row(org_id=org_id, args=args)
    if tool_name == "create_row":
        return _tool_create_row(
            org_id=org_id,
            role=role,
            allow_mutations=allow_mutations,
            confirm_write=confirm_write,
            args=args,
        )
    if tool_name == "update_row":
        return _tool_update_row(
            org_id=org_id,
            role=role,
            allow_mutations=allow_mutations,
            confirm_write=confirm_write,
            args=args,
        )
    if tool_name == "delete_row":
        return _tool_delete_row(
            org_id=org_id,
            role=role,
            allow_mutations=allow_mutations,
            confirm_write=confirm_write,
            args=args,
        )

    return {"ok": False, "error": f"Unknown tool: {tool_name}"}


def _tool_list_rows(*, org_id: str, args: dict[str, Any]) -> dict[str, Any]:
    table = _normalize_table(args.get("table"))
    table_cfg = _table_config(table)
    org_column = str(table_cfg.get("org_column") or "organization_id")
    limit = _coerce_limit(args.get("limit"), default=30)
    order_by = str(args.get("order_by") or "created_at").strip()
    ascending = bool(args.get("ascending", False))
    filters = _normalize_json_object(args.get("filters"), field_name="filters")

    client = get_supabase_client()
    query = client.table(table).select("*")
    query = _apply_org_scope(query, org_column=org_column, org_id=org_id)

    for key, value in filters.items():
        column = str(key).strip()
        if not column or column == org_column:
            continue
        query = _apply_filter(query, column, value)

    query = query.range(0, limit - 1)
    if order_by:
        query = query.order(order_by, desc=not ascending)

    response = query.execute()
    return {
        "ok": True,
        "table": table,
        "rows": response.data or [],
    }


def _tool_get_row(*, org_id: str, args: dict[str, Any]) -> dict[str, Any]:
    table = _normalize_table(args.get("table"))
    table_cfg = _table_config(table)
    org_column = str(table_cfg.get("org_column") or "organization_id")
    row_id = str(args.get("row_id") or "").strip()
    id_field = str(args.get("id_field") or "id").strip() or "id"

    if not row_id:
        return {"ok": False, "error": "row_id is required."}

    client = get_supabase_client()
    query = client.table(table).select("*").eq(id_field, row_id).limit(1)
    query = _apply_org_scope(query, org_column=org_column, org_id=org_id)
    response = query.execute()

    rows = response.data or []
    if not rows:
        return {"ok": False, "error": f"No record found in {table}."}

    return {"ok": True, "table": table, "row": rows[0]}


def _tool_create_row(
    *,
    org_id: str,
    role: str,
    allow_mutations: bool,
    confirm_write: bool,
    args: dict[str, Any],
) -> dict[str, Any]:
    allowed, detail = _assert_mutation_allowed(
        role=role,
        allow_mutations=allow_mutations,
        confirm_write=confirm_write,
    )
    if not allowed:
        return {"ok": False, "error": detail}

    table = _normalize_table(args.get("table"))
    table_cfg = _table_config(table)
    if table_cfg.get("can_create", True) is False:
        return {"ok": False, "error": f"Create is not allowed for table '{table}'."}

    org_column = str(table_cfg.get("org_column") or "organization_id")
    payload = _normalize_json_object(args.get("payload"), field_name="payload")
    payload = _sanitize_mutation_payload(payload)
    payload[org_column] = org_id

    client = get_supabase_client()
    response = client.table(table).insert(payload).execute()
    rows = response.data or []

    if not rows:
        return {"ok": False, "error": f"Create failed for table '{table}'."}

    return {"ok": True, "table": table, "row": rows[0]}


def _tool_update_row(
    *,
    org_id: str,
    role: str,
    allow_mutations: bool,
    confirm_write: bool,
    args: dict[str, Any],
) -> dict[str, Any]:
    allowed, detail = _assert_mutation_allowed(
        role=role,
        allow_mutations=allow_mutations,
        confirm_write=confirm_write,
    )
    if not allowed:
        return {"ok": False, "error": detail}

    table = _normalize_table(args.get("table"))
    table_cfg = _table_config(table)
    if table_cfg.get("can_update", True) is False:
        return {"ok": False, "error": f"Update is not allowed for table '{table}'."}

    org_column = str(table_cfg.get("org_column") or "organization_id")
    row_id = str(args.get("row_id") or "").strip()
    id_field = str(args.get("id_field") or "id").strip() or "id"
    payload = _normalize_json_object(args.get("payload"), field_name="payload")

    if not row_id:
        return {"ok": False, "error": "row_id is required."}

    safe_payload = _sanitize_mutation_payload(payload)
    safe_payload.pop(org_column, None)
    if not safe_payload:
        return {"ok": False, "error": "No updatable fields provided."}

    client = get_supabase_client()
    query = client.table(table).update(safe_payload).eq(id_field, row_id)
    query = _apply_org_scope(query, org_column=org_column, org_id=org_id)
    response = query.execute()
    rows = response.data or []

    if not rows:
        return {"ok": False, "error": f"No matching row found for update in '{table}'."}

    return {"ok": True, "table": table, "row": rows[0]}


def _tool_delete_row(
    *,
    org_id: str,
    role: str,
    allow_mutations: bool,
    confirm_write: bool,
    args: dict[str, Any],
) -> dict[str, Any]:
    allowed, detail = _assert_mutation_allowed(
        role=role,
        allow_mutations=allow_mutations,
        confirm_write=confirm_write,
    )
    if not allowed:
        return {"ok": False, "error": detail}

    table = _normalize_table(args.get("table"))
    table_cfg = _table_config(table)
    if table_cfg.get("can_delete", True) is False:
        return {"ok": False, "error": f"Delete is not allowed for table '{table}'."}

    org_column = str(table_cfg.get("org_column") or "organization_id")
    row_id = str(args.get("row_id") or "").strip()
    id_field = str(args.get("id_field") or "id").strip() or "id"

    if not row_id:
        return {"ok": False, "error": "row_id is required."}

    client = get_supabase_client()
    read_query = client.table(table).select("*").eq(id_field, row_id).limit(1)
    read_query = _apply_org_scope(read_query, org_column=org_column, org_id=org_id)
    read_response = read_query.execute()
    existing = (read_response.data or [None])[0]
    if not existing:
        return {"ok": False, "error": f"No matching row found for delete in '{table}'."}

    delete_query = client.table(table).delete().eq(id_field, row_id)
    delete_query = _apply_org_scope(delete_query, org_column=org_column, org_id=org_id)
    delete_query.execute()
    return {"ok": True, "table": table, "row": existing}


def _tool_get_org_snapshot(*, org_id: str) -> dict[str, Any]:
    tracked_tables = [
        "properties",
        "units",
        "reservations",
        "tasks",
        "application_submissions",
        "leases",
        "collection_records",
        "marketplace_listings",
    ]

    client = get_supabase_client()
    summary: dict[str, int] = {}

    for table in tracked_tables:
        cfg = _table_config(table)
        org_column = str(cfg.get("org_column") or "organization_id")
        query = client.table(table).select("id", count="exact").eq(org_column, org_id).limit(1)
        response = query.execute()
        count = getattr(response, "count", None)
        if count is None:
            count = len(response.data or [])
        summary[table] = int(count)

    return {"ok": True, "summary": summary}


def _apply_filter(query: Any, column: str, value: Any) -> Any:
    if isinstance(value, dict):
        op = str(value.get("op") or "eq").strip().lower()
        operand = value.get("value")

        if op == "eq":
            return query.eq(column, operand)
        if op == "neq":
            return query.neq(column, operand)
        if op == "gt":
            return query.gt(column, operand)
        if op == "gte":
            return query.gte(column, operand)
        if op == "lt":
            return query.lt(column, operand)
        if op == "lte":
            return query.lte(column, operand)
        if op == "ilike":
            return query.ilike(column, str(operand))
        if op == "in" and isinstance(operand, list):
            return query.in_(column, operand)
        return query.eq(column, operand)

    if isinstance(value, list):
        return query.in_(column, value)

    return query.eq(column, value)


def _apply_org_scope(query: Any, *, org_column: str, org_id: str) -> Any:
    return query.eq(org_column, org_id)


def _table_config(table: str) -> dict[str, Any]:
    config = _ALLOWED_TABLES.get(table)
    if not config:
        raise HTTPException(status_code=400, detail=f"Table '{table}' is not allowed for AI access.")
    return config


def _normalize_table(value: Any) -> str:
    table = str(value or "").strip()
    if not table:
        raise HTTPException(status_code=400, detail="table is required.")
    _table_config(table)
    return table


def _sanitize_mutation_payload(payload: dict[str, Any]) -> dict[str, Any]:
    next_payload = dict(payload)
    for blocked_field in ["id", "created_at", "updated_at"]:
        next_payload.pop(blocked_field, None)
    return next_payload


def _normalize_json_object(value: Any, *, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    raise HTTPException(status_code=400, detail=f"{field_name} must be an object.")


def _coerce_limit(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(1, min(parsed, 200))


def _assert_mutation_allowed(*, role: str, allow_mutations: bool, confirm_write: bool) -> tuple[bool, str]:
    if not allow_mutations:
        return False, "Mutations are disabled. Enable write mode to create/update/delete rows."
    if not confirm_write:
        return False, "Write confirmation is required. Confirm this action before running mutations."
    if role not in _MUTATION_ROLES:
        return False, f"Role '{role or 'viewer'}' is read-only for AI mutations."
    return True, "ok"


def _mutations_allowed(role: str, allow_mutations: bool, confirm_write: bool) -> bool:
    allowed, _detail = _assert_mutation_allowed(
        role=role,
        allow_mutations=allow_mutations,
        confirm_write=confirm_write,
    )
    return allowed


def _parse_tool_arguments(raw_arguments: Any) -> dict[str, Any]:
    if raw_arguments is None:
        return {}
    if isinstance(raw_arguments, dict):
        return raw_arguments
    if isinstance(raw_arguments, str):
        text = raw_arguments.strip()
        if not text:
            return {}
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    raise HTTPException(status_code=400, detail="Invalid tool arguments payload.")


def _extract_content_text(content: Any) -> str:
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        chunks: list[str] = []
        for part in content:
            if isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        return "\n".join(chunk.strip() for chunk in chunks if chunk.strip())

    return ""


def _preview_result(result: dict[str, Any]) -> str:
    if not result.get("ok"):
        return str(result.get("error") or "Operation failed.")
    if "row" in result and isinstance(result["row"], dict):
        row = result["row"]
        preview_id = row.get("id")
        return f"row={preview_id}" if preview_id else "row updated"
    if "rows" in result and isinstance(result["rows"], list):
        return f"rows={len(result['rows'])}"
    if "summary" in result and isinstance(result["summary"], dict):
        return "snapshot ready"
    if "tables" in result and isinstance(result["tables"], list):
        return f"tables={len(result['tables'])}"
    return "ok"


def _call_openai_chat_completion(
    *,
    messages: list[dict[str, Any]],
    tools: Optional[list[dict[str, Any]]],
) -> tuple[dict[str, Any], str, bool]:
    api_key = settings.openai_api_key
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="OPENAI_API_KEY is missing. Configure it in backend environment variables.",
        )

    model_chain = settings.openai_model_chain
    if not model_chain:
        raise HTTPException(status_code=503, detail="No OpenAI model is configured.")

    last_error: Optional[HTTPException] = None
    fallback_used = False

    for index, model_name in enumerate(model_chain):
        payload: dict[str, Any] = {
            "model": model_name,
            "messages": messages,
            "temperature": 0.1,
        }
        if tools is not None:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        request = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=settings.ai_agent_timeout_seconds) as response:
                body = response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as exc:
            error_body = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
            if settings.is_production:
                detail = "AI provider request failed."
            else:
                detail = f"AI provider request failed ({exc.code}) on model '{model_name}': {error_body or exc.reason}"
            last_error = HTTPException(status_code=502, detail=detail)
            if index < len(model_chain) - 1:
                fallback_used = True
                continue
            raise last_error from exc
        except Exception as exc:
            detail = "AI provider is unreachable."
            if not settings.is_production:
                detail = f"AI provider is unreachable on model '{model_name}': {exc}"
            last_error = HTTPException(status_code=502, detail=detail)
            if index < len(model_chain) - 1:
                fallback_used = True
                continue
            raise last_error from exc

        try:
            parsed = json.loads(body)
        except json.JSONDecodeError as exc:
            last_error = HTTPException(status_code=502, detail="AI provider returned an invalid JSON response.")
            if index < len(model_chain) - 1:
                fallback_used = True
                continue
            raise last_error from exc

        if not isinstance(parsed, dict):
            last_error = HTTPException(status_code=502, detail="AI provider response is malformed.")
            if index < len(model_chain) - 1:
                fallback_used = True
                continue
            raise last_error

        return parsed, model_name, fallback_used or index > 0

    if last_error:
        raise last_error
    raise HTTPException(status_code=502, detail="AI provider request failed.")
