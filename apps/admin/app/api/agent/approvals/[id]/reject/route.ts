import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type RouteParams = {
  params: Promise<{ id: string }>;
};

type ReviewPayload = {
  org_id?: string;
  note?: string | null;
};

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;

  let payload: ReviewPayload;
  try {
    payload = (await request.json()) as ReviewPayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = payload.org_id?.trim() ?? "";
  if (!(id && orgId)) {
    return NextResponse.json(
      { ok: false, error: "id and org_id are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/approvals/${encodeURIComponent(id)}/reject?org_id=${encodeURIComponent(orgId)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        note: typeof payload.note === "string" ? payload.note : null,
      }),
    }
  );
}
