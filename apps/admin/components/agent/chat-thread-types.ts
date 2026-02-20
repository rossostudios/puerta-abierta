"use client";

import type { AgentChatMessage, AgentChatSummary } from "@/lib/api";

export const ZOEY_PROMPTS: { "en-US": string[]; "es-PY": string[] } = {
  "en-US": [
    "Give me today's top 5 priorities.",
    "Show all guests arriving in the next 7 days.",
    "Summarize this month's revenue by property.",
  ],
  "es-PY": [
    "Dame las 5 prioridades de hoy.",
    "Muéstrame todos los huéspedes que llegan en los próximos 7 días.",
    "Resume los ingresos de este mes por propiedad.",
  ],
};

export const MESSAGE_SKELETON_KEYS = [
  "message-skeleton-1",
  "message-skeleton-2",
  "message-skeleton-3",
  "message-skeleton-4",
  "message-skeleton-5",
];

export type ThreadData = {
  chat: AgentChatSummary | null;
  messages: AgentChatMessage[];
};

export type StreamingTool = {
  name: string;
  preview?: string;
  ok?: boolean;
};

function normalizeChat(payload: unknown): AgentChatSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (!(row.id && row.title)) return null;

  return {
    id: String(row.id),
    org_id: String(row.org_id ?? ""),
    agent_id: String(row.agent_id ?? ""),
    agent_slug: String(row.agent_slug ?? ""),
    agent_name: String(row.agent_name ?? ""),
    agent_icon_key:
      typeof row.agent_icon_key === "string" ? row.agent_icon_key : undefined,
    title: String(row.title),
    is_archived: Boolean(row.is_archived),
    last_message_at: String(row.last_message_at ?? ""),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
    latest_message_preview:
      typeof row.latest_message_preview === "string"
        ? row.latest_message_preview
        : null,
  };
}

export { normalizeChat };

function normalizeMessages(payload: unknown): AgentChatMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown[] }).data;
  if (!Array.isArray(data)) return [];

  return data
    .filter((row): row is AgentChatMessage =>
      Boolean(row && typeof row === "object")
    )
    .map((row) => {
      const role: "user" | "assistant" =
        row.role === "assistant" ? "assistant" : "user";

      return {
        id: String(row.id ?? ""),
        chat_id: String(row.chat_id ?? ""),
        org_id: String(row.org_id ?? ""),
        role,
        content: String(row.content ?? ""),
        tool_trace: Array.isArray(row.tool_trace)
          ? (row.tool_trace as AgentChatMessage["tool_trace"])
          : undefined,
        model_used:
          typeof row.model_used === "string" ? row.model_used : undefined,
        fallback_used: Boolean(row.fallback_used ?? false),
        created_at: String(row.created_at ?? ""),
      };
    })
    .filter((row) => row.id && row.content);
}

export async function fetchThread(
  chatId: string,
  orgId: string
): Promise<ThreadData> {
  const [chatRes, messagesRes] = await Promise.all([
    fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }
    ),
    fetch(
      `/api/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}&limit=160`,
      {
        method: "GET",
        cache: "no-store",
        headers: { Accept: "application/json" },
      }
    ),
  ]);

  const chatPayload = (await chatRes.json()) as unknown;
  const messagesPayload = (await messagesRes.json()) as unknown;

  if (!chatRes.ok) {
    let message = "Could not load chat.";
    if (
      chatPayload != null &&
      typeof chatPayload === "object" &&
      "error" in chatPayload
    ) {
      message = String((chatPayload as { error?: unknown }).error);
    }
    throw new Error(message);
  }

  if (!messagesRes.ok) {
    let message = "Could not load messages.";
    if (
      messagesPayload != null &&
      typeof messagesPayload === "object" &&
      "error" in messagesPayload
    ) {
      message = String((messagesPayload as { error?: unknown }).error);
    }
    throw new Error(message);
  }

  return {
    chat: normalizeChat(chatPayload),
    messages: normalizeMessages(messagesPayload),
  };
}
