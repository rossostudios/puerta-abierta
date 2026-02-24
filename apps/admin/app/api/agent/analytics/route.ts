import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get("org_id")?.trim() ?? "";
  const period = searchParams.get("period")?.trim() ?? "7";

  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/ai-agents/dashboard/analytics?org_id=${encodeURIComponent(orgId)}&period=${encodeURIComponent(period)}`
  );
}
