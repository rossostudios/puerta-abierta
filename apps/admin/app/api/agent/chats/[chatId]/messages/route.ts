import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type SendMessagePayload = {
  org_id?: string;
  message?: string;
  allow_mutations?: boolean;
  confirm_write?: boolean;
};

export async function GET(request: Request, { params }: RouteParams) {
  const { chatId } = await params;
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? "120");

  if (!(chatId && orgId)) {
    return NextResponse.json(
      { ok: false, error: "chatId and org_id are required." },
      { status: 400 }
    );
  }

  const qs = new URLSearchParams({
    org_id: orgId,
    limit: String(Number.isFinite(limit) ? limit : 120),
  });

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}/messages?${qs.toString()}`
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const { chatId } = await params;

  let payload: SendMessagePayload;
  try {
    payload = (await request.json()) as SendMessagePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = payload.org_id?.trim() ?? "";
  const message = payload.message?.trim() ?? "";

  if (!(chatId && orgId && message)) {
    return NextResponse.json(
      { ok: false, error: "chatId, org_id, and message are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}/messages?org_id=${encodeURIComponent(orgId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message,
        allow_mutations: payload.allow_mutations === true,
        confirm_write: payload.confirm_write === true,
      }),
    }
  );
}
