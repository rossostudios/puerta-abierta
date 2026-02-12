import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type ChatActionPayload = {
  org_id?: string;
  action?: "archive" | "restore";
};

function queryFor(orgId: string): string {
  return `org_id=${encodeURIComponent(orgId)}`;
}

export async function GET(request: Request, { params }: RouteParams) {
  const { chatId } = await params;
  const orgId = new URL(request.url).searchParams.get("org_id")?.trim() ?? "";

  if (!(chatId && orgId)) {
    return NextResponse.json(
      { ok: false, error: "chatId and org_id are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}?${queryFor(orgId)}`
  );
}

export async function POST(request: Request, { params }: RouteParams) {
  const { chatId } = await params;

  let payload: ChatActionPayload;
  try {
    payload = (await request.json()) as ChatActionPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = payload.org_id?.trim() ?? "";
  const action = payload.action;

  if (!(chatId && orgId && (action === "archive" || action === "restore"))) {
    return NextResponse.json(
      { ok: false, error: "chatId, org_id, and valid action are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}/${action}?${queryFor(orgId)}`,
    {
      method: "POST",
    }
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { chatId } = await params;
  const orgId = new URL(request.url).searchParams.get("org_id")?.trim() ?? "";

  if (!(chatId && orgId)) {
    return NextResponse.json(
      { ok: false, error: "chatId and org_id are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}?${queryFor(orgId)}`,
    {
      method: "DELETE",
    }
  );
}
