import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type RouteParams = {
  params: Promise<{ chatId: string; messageId: string }>;
};

type FeedbackPayload = {
  rating?: string;
  reason?: string;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { chatId, messageId } = await params;
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id")?.trim() ?? "";

  if (!(chatId && messageId && orgId)) {
    return NextResponse.json(
      { ok: false, error: "chatId, messageId, and org_id are required." },
      { status: 400 }
    );
  }

  let payload: FeedbackPayload;
  try {
    payload = (await request.json()) as FeedbackPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const rating = payload.rating?.trim() ?? "";
  if (rating !== "positive" && rating !== "negative") {
    return NextResponse.json(
      { ok: false, error: "rating must be 'positive' or 'negative'." },
      { status: 400 }
    );
  }

  const reason = payload.reason?.trim() || undefined;

  return forwardAgentRequest(
    `/agent/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/feedback?org_id=${encodeURIComponent(orgId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating, reason }),
    }
  );
}
