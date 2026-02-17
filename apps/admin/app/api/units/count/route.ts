import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id");
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "Missing org_id" },
      { status: 400 }
    );
  }

  const res = await forwardAgentRequest(
    `/units?org_id=${encodeURIComponent(orgId)}&limit=1`
  );

  const body = (await res.json()) as { total?: number; data?: unknown[] };

  const count =
    typeof body.total === "number"
      ? body.total
      : Array.isArray(body.data)
        ? body.data.length
        : null;

  return NextResponse.json({ count });
}
