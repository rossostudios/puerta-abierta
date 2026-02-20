import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

export function GET(request: Request) {
  const orgId = new URL(request.url).searchParams.get("org_id")?.trim() ?? "";
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/approval-policies?org_id=${encodeURIComponent(orgId)}`
  );
}
