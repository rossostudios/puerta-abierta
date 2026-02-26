import { NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type AgentChatPayload = {
  org_id?: string;
  message?: string;
  conversation?: Array<{ role?: string; content?: string }>;
  allow_mutations?: boolean;
};

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

  try {
    const response = await fetch(`${API_BASE_URL}/agent/chat`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        org_id: orgId,
        message,
        conversation: Array.isArray(payload.conversation)
          ? payload.conversation
          : [],
        allow_mutations: payload.allow_mutations === true,
      }),
    });

    const text = await response.text().catch(() => "");
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = {};
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof parsed === "object" &&
            parsed &&
            "detail" in (parsed as Record<string, unknown>)
              ? (parsed as Record<string, unknown>).detail
              : text || response.statusText,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(parsed);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
