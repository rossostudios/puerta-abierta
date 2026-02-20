import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type RouteParams = {
  params: Promise<{ chatId: string }>;
};

type StreamMessagePayload = {
  org_id?: string;
  message?: string;
  allow_mutations?: boolean;
  confirm_write?: boolean;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { chatId } = await params;
  const searchParams = new URL(request.url).searchParams;

  let payload: StreamMessagePayload;
  try {
    payload = (await request.json()) as StreamMessagePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId =
    searchParams.get("org_id")?.trim() ?? payload.org_id?.trim() ?? "";
  const message = payload.message?.trim() ?? "";

  if (!(chatId && orgId && message)) {
    return NextResponse.json(
      { ok: false, error: "chatId, org_id, and message are required." },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? null;

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/agent/chats/${encodeURIComponent(chatId)}/messages/stream?org_id=${encodeURIComponent(orgId)}`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message,
          allow_mutations: payload.allow_mutations === true,
          confirm_write: payload.confirm_write === true,
        }),
      }
    );

    if (!(response.ok && response.body)) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        {
          ok: false,
          error: text || response.statusText || "Streaming request failed.",
        },
        { status: response.status || 502 }
      );
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("content-type") ?? "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
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
