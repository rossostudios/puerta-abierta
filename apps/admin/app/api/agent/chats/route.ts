import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type CreateChatPayload = {
  org_id?: string;
  agent_slug?: string;
  title?: string;
};

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id")?.trim() ?? "";
  const archived =
    searchParams.get("archived")?.trim().toLowerCase() === "true";
  const limit = Number(searchParams.get("limit") ?? "30");

  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required." },
      { status: 400 }
    );
  }

  const qs = new URLSearchParams({
    org_id: orgId,
    archived: String(archived),
    limit: String(Number.isFinite(limit) ? limit : 30),
  });

  return forwardAgentRequest(`/agent/chats?${qs.toString()}`);
}

export async function POST(request: Request) {
  let payload: CreateChatPayload;
  try {
    payload = (await request.json()) as CreateChatPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = payload.org_id?.trim() ?? "";
  const agentSlug = payload.agent_slug?.trim() ?? "";

  if (!(orgId && agentSlug)) {
    return NextResponse.json(
      { ok: false, error: "org_id and agent_slug are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest("/agent/chats", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      org_id: orgId,
      agent_slug: agentSlug,
      title: typeof payload.title === "string" ? payload.title : undefined,
    }),
  });
}
