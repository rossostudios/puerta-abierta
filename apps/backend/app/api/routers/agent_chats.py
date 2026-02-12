from fastapi import APIRouter, Depends

from app.core.auth import require_user_id
from app.core.tenancy import assert_org_member
from app.schemas.domain import CreateAgentChatInput, SendAgentMessageInput
from app.services.agent_chats import (
    archive_chat,
    create_chat,
    delete_chat,
    get_chat,
    list_agents,
    list_chat_messages,
    list_chats,
    restore_chat,
    send_chat_message,
)
from app.services.audit import write_audit_log

router = APIRouter(tags=["agent-chats"])


@router.get("/agent/agents")
def get_agent_definitions(org_id: str, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    data = list_agents(org_id=org_id)
    return {
        "organization_id": org_id,
        "data": data,
    }


@router.get("/agent/chats")
def get_agent_chats(
    org_id: str,
    archived: bool = False,
    limit: int = 30,
    user_id=Depends(require_user_id),
) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    data = list_chats(
        org_id=org_id,
        user_id=user_id,
        archived=archived,
        limit=limit,
    )
    return {
        "organization_id": org_id,
        "archived": archived,
        "data": data,
    }


@router.post("/agent/chats")
def create_agent_chat(payload: CreateAgentChatInput, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=payload.org_id)
    chat = create_chat(
        org_id=payload.org_id,
        user_id=user_id,
        agent_slug=payload.agent_slug,
        title=payload.title,
    )

    write_audit_log(
        organization_id=payload.org_id,
        actor_user_id=user_id,
        action="agent.chat.create",
        entity_name="ai_chat",
        entity_id=chat.get("id"),
        after_state={
            "agent_slug": payload.agent_slug,
            "title": chat.get("title"),
        },
    )

    return chat


@router.get("/agent/chats/{chat_id}")
def get_agent_chat(chat_id: str, org_id: str, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    return get_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)


@router.get("/agent/chats/{chat_id}/messages")
def get_agent_chat_messages(
    chat_id: str,
    org_id: str,
    limit: int = 120,
    user_id=Depends(require_user_id),
) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    data = list_chat_messages(
        chat_id=chat_id,
        org_id=org_id,
        user_id=user_id,
        limit=limit,
    )
    return {
        "organization_id": org_id,
        "chat_id": chat_id,
        "data": data,
    }


@router.post("/agent/chats/{chat_id}/messages")
def post_agent_chat_message(
    chat_id: str,
    payload: SendAgentMessageInput,
    org_id: str,
    user_id=Depends(require_user_id),
) -> dict:
    membership = assert_org_member(user_id=user_id, org_id=org_id)
    role = str(membership.get("role") or "viewer")

    result = send_chat_message(
        chat_id=chat_id,
        org_id=org_id,
        user_id=user_id,
        role=role,
        message=payload.message,
        allow_mutations=payload.allow_mutations,
        confirm_write=payload.confirm_write,
    )

    if payload.allow_mutations:
        write_audit_log(
            organization_id=org_id,
            actor_user_id=user_id,
            action="agent.chat.write_attempt",
            entity_name="ai_chat",
            entity_id=chat_id,
            after_state={
                "role": role,
                "confirm_write": payload.confirm_write,
                "tool_trace_count": len(result.get("tool_trace") or []),
                "mutations_enabled": bool(result.get("mutations_enabled", False)),
            },
        )

    return {
        "organization_id": org_id,
        "chat_id": chat_id,
        "role": role,
        **result,
    }


@router.post("/agent/chats/{chat_id}/archive")
def archive_agent_chat(chat_id: str, org_id: str, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    chat = archive_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="agent.chat.archive",
        entity_name="ai_chat",
        entity_id=chat_id,
        after_state={"is_archived": True},
    )

    return {
        "ok": True,
        "organization_id": org_id,
        "chat_id": chat_id,
        "is_archived": bool(chat.get("is_archived", False)),
    }


@router.post("/agent/chats/{chat_id}/restore")
def restore_agent_chat(chat_id: str, org_id: str, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    chat = restore_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="agent.chat.restore",
        entity_name="ai_chat",
        entity_id=chat_id,
        after_state={"is_archived": bool(chat.get("is_archived", False))},
    )

    return {
        "ok": True,
        "organization_id": org_id,
        "chat_id": chat_id,
        "is_archived": bool(chat.get("is_archived", False)),
    }


@router.delete("/agent/chats/{chat_id}")
def delete_agent_chat(chat_id: str, org_id: str, user_id=Depends(require_user_id)) -> dict:
    assert_org_member(user_id=user_id, org_id=org_id)
    deleted = delete_chat(chat_id=chat_id, org_id=org_id, user_id=user_id)

    write_audit_log(
        organization_id=org_id,
        actor_user_id=user_id,
        action="agent.chat.delete",
        entity_name="ai_chat",
        entity_id=chat_id,
        before_state={
            "title": deleted.get("title"),
            "is_archived": bool(deleted.get("is_archived", False)),
        },
    )

    return {
        "ok": True,
        "organization_id": org_id,
        "chat_id": chat_id,
    }
