import unittest
from unittest.mock import patch

from app.api.routers.agent_chats import (
    create_agent_chat,
    delete_agent_chat,
    get_agent_chat_messages,
    get_agent_chats,
    get_agent_definitions,
    post_agent_chat_message,
)
from app.schemas.domain import CreateAgentChatInput, SendAgentMessageInput


class AgentChatsRouterTest(unittest.TestCase):
    @patch("app.api.routers.agent_chats.list_agents")
    @patch("app.api.routers.agent_chats.assert_org_member")
    def test_get_agent_definitions(self, mock_assert_org_member, mock_list_agents):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "operator",
        }
        mock_list_agents.return_value = [{"slug": "morning-brief"}]

        result = get_agent_definitions(org_id="org-1", user_id="user-1")

        self.assertEqual(result["organization_id"], "org-1")
        self.assertEqual(len(result["data"]), 1)
        mock_assert_org_member.assert_called_once_with(user_id="user-1", org_id="org-1")
        mock_list_agents.assert_called_once_with(org_id="org-1")

    @patch("app.api.routers.agent_chats.list_chats")
    @patch("app.api.routers.agent_chats.assert_org_member")
    def test_get_agent_chats(self, mock_assert_org_member, mock_list_chats):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "operator",
        }
        mock_list_chats.return_value = [{"id": "chat-1"}]

        result = get_agent_chats(org_id="org-1", archived=False, limit=20, user_id="user-1")

        self.assertEqual(result["organization_id"], "org-1")
        self.assertEqual(result["archived"], False)
        self.assertEqual(len(result["data"]), 1)
        mock_list_chats.assert_called_once_with(
            org_id="org-1",
            user_id="user-1",
            archived=False,
            limit=20,
        )

    @patch("app.api.routers.agent_chats.write_audit_log")
    @patch("app.api.routers.agent_chats.create_chat")
    @patch("app.api.routers.agent_chats.assert_org_member")
    def test_create_agent_chat(
        self,
        mock_assert_org_member,
        mock_create_chat,
        mock_write_audit_log,
    ):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "owner_admin",
        }
        mock_create_chat.return_value = {
            "id": "chat-1",
            "title": "Morning",
        }

        payload = CreateAgentChatInput(
            org_id="org-1",
            agent_slug="morning-brief",
            title="Morning",
        )

        result = create_agent_chat(payload, user_id="user-1")

        self.assertEqual(result["id"], "chat-1")
        mock_create_chat.assert_called_once_with(
            org_id="org-1",
            user_id="user-1",
            agent_slug="morning-brief",
            title="Morning",
        )
        mock_write_audit_log.assert_called_once()

    @patch("app.api.routers.agent_chats.send_chat_message")
    @patch("app.api.routers.agent_chats.assert_org_member")
    @patch("app.api.routers.agent_chats.write_audit_log")
    def test_post_agent_chat_message_with_write_attempt(
        self,
        mock_write_audit_log,
        mock_assert_org_member,
        mock_send_chat_message,
    ):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "operator",
        }
        mock_send_chat_message.return_value = {
            "reply": "Done",
            "tool_trace": [{"tool": "update_row", "ok": True}],
            "mutations_enabled": True,
        }

        payload = SendAgentMessageInput(
            message="mark paid",
            allow_mutations=True,
            confirm_write=True,
        )

        result = post_agent_chat_message(
            chat_id="chat-1",
            payload=payload,
            org_id="org-1",
            user_id="user-1",
        )

        self.assertEqual(result["organization_id"], "org-1")
        self.assertEqual(result["chat_id"], "chat-1")
        self.assertEqual(result["role"], "operator")
        self.assertEqual(result["reply"], "Done")

        mock_send_chat_message.assert_called_once_with(
            chat_id="chat-1",
            org_id="org-1",
            user_id="user-1",
            role="operator",
            message="mark paid",
            allow_mutations=True,
            confirm_write=True,
        )
        mock_write_audit_log.assert_called_once()

    @patch("app.api.routers.agent_chats.list_chat_messages")
    @patch("app.api.routers.agent_chats.assert_org_member")
    def test_get_agent_chat_messages(self, mock_assert_org_member, mock_list_chat_messages):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "operator",
        }
        mock_list_chat_messages.return_value = [{"id": "msg-1"}]

        result = get_agent_chat_messages(
            chat_id="chat-1",
            org_id="org-1",
            limit=50,
            user_id="user-1",
        )

        self.assertEqual(result["chat_id"], "chat-1")
        self.assertEqual(len(result["data"]), 1)
        mock_list_chat_messages.assert_called_once_with(
            chat_id="chat-1",
            org_id="org-1",
            user_id="user-1",
            limit=50,
        )

    @patch("app.api.routers.agent_chats.write_audit_log")
    @patch("app.api.routers.agent_chats.delete_chat")
    @patch("app.api.routers.agent_chats.assert_org_member")
    def test_delete_agent_chat(
        self,
        mock_assert_org_member,
        mock_delete_chat,
        mock_write_audit_log,
    ):
        mock_assert_org_member.return_value = {
            "organization_id": "org-1",
            "user_id": "user-1",
            "role": "owner_admin",
        }
        mock_delete_chat.return_value = {
            "title": "Chat",
            "is_archived": False,
        }

        result = delete_agent_chat(chat_id="chat-1", org_id="org-1", user_id="user-1")

        self.assertEqual(result["ok"], True)
        self.assertEqual(result["chat_id"], "chat-1")
        mock_delete_chat.assert_called_once_with(chat_id="chat-1", org_id="org-1", user_id="user-1")
        mock_write_audit_log.assert_called_once()


if __name__ == "__main__":
    unittest.main()
