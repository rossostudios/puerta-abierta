import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

export function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const orgId = searchParams.get("org_id")?.trim() ?? "";
  const limit = Number(searchParams.get("limit") ?? "60");

  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required." },
      { status: 400 }
    );
  }

  const qs = new URLSearchParams({
    org_id: orgId,
    limit: String(Number.isFinite(limit) ? limit : 60),
  });

  return forwardAgentRequest(`/agent/inbox?${qs.toString()}`);
}
