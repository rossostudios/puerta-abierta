import { NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const API_BASE_URL = SERVER_API_BASE_URL;

type AgentChatPayload = {
  org_id?: string;
  message?: string;
  conversation?: Array<{ role?: string; content?: string }>;
  allow_mutations?: boolean;
};

type BackendError = {
  detail?: string;
  error?: string;
};

const COMPOSE_ASSIST_AGENT = "guest-concierge";

function sanitizeConversation(
  rows: AgentChatPayload["conversation"]
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((item) => {
      const role = item?.role === "assistant" ? "assistant" : "user";
      const content =
        typeof item?.content === "string" ? item.content.trim() : "";
      if (!content) {
        return null;
      }
      return { role, content };
    })
    .filter((item): item is { role: "user" | "assistant"; content: string } =>
      Boolean(item)
    )
    .slice(-20);
}

function buildComposePrompt(
  baseMessage: string,
  conversation: ReturnType<typeof sanitizeConversation>
): string {
  if (conversation.length === 0) {
    return baseMessage;
  }

  const transcript = conversation
    .map(
      (row) => `${row.role === "assistant" ? "Agent" : "Guest"}: ${row.content}`
    )
    .join("\n");

  return [
    "Use the conversation transcript to draft the best next reply.",
    "Return only the final reply body with no prefacing text.",
    "",
    "Conversation:",
    transcript,
    "",
    "Task:",
    baseMessage,
  ].join("\n");
}

async function parseBackendError(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return response.statusText || "Upstream request failed.";
  }

  try {
    const parsed = JSON.parse(text) as BackendError;
    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return parsed.detail;
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // fall through
  }

  return text;
}

export async function POST(request: Request) {
  let payload: AgentChatPayload;
  try {
    payload = (await request.json()) as AgentChatPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = typeof payload.org_id === "string" ? payload.org_id.trim() : "";
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";

  if (!(orgId && message)) {
    return NextResponse.json(
      { ok: false, error: "org_id and message are required." },
      { status: 400 }
    );
  }

  const token = await getServerAccessToken();
  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const conversation = sanitizeConversation(payload.conversation);
  const composedMessage = buildComposePrompt(message, conversation);

  let chatId = "";
  try {
    const createRes = await fetch(`${API_BASE_URL}/agent/chats`, {
      method: "POST",
      headers,
      cache: "no-store",
      body: JSON.stringify({
        org_id: orgId,
        agent_slug: COMPOSE_ASSIST_AGENT,
        title: "Compose Assist",
      }),
    });

    if (!createRes.ok) {
      const error = await parseBackendError(createRes);
      return NextResponse.json(
        { ok: false, error },
        { status: createRes.status }
      );
    }

    const created = (await createRes.json().catch(() => ({}))) as {
      id?: string;
    };
    chatId = typeof created.id === "string" ? created.id : "";
    if (!chatId) {
      return NextResponse.json(
        { ok: false, error: "Failed to initialize compose runtime chat." },
        { status: 502 }
      );
    }

    const sendRes = await fetch(
      `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({
          message: composedMessage,
          allow_mutations: payload.allow_mutations === true,
          confirm_write: false,
        }),
      }
    );

    if (!sendRes.ok) {
      const error = await parseBackendError(sendRes);
      return NextResponse.json(
        { ok: false, error },
        { status: sendRes.status }
      );
    }

    const result = (await sendRes.json().catch(() => ({}))) as {
      reply?: string;
      assistant_message?: { content?: string };
      runtime_version?: string;
      run_id?: string;
      trace_id?: string;
    };

    const reply =
      typeof result.reply === "string" && result.reply.trim()
        ? result.reply
        : (result.assistant_message?.content ?? "");

    if (!reply.trim()) {
      return NextResponse.json(
        { ok: false, error: "No draft generated." },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      reply,
      runtime_version: result.runtime_version,
      run_id: result.run_id,
      trace_id: result.trace_id,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  } finally {
    if (chatId) {
      fetch(
        `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/archive?org_id=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers,
          cache: "no-store",
        }
      ).catch(() => undefined);
    }
  }
}
