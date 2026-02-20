import { NextResponse } from "next/server";

import { forwardAgentRequest } from "@/app/api/agent/_proxy";

type RouteParams = {
  params: Promise<{ toolName: string }>;
};

type UpdatePayload = {
  org_id?: string;
  approval_mode?: "required" | "auto";
  enabled?: boolean;
};

export async function PATCH(request: Request, { params }: RouteParams) {
  const { toolName } = await params;

  let payload: UpdatePayload;
  try {
    payload = (await request.json()) as UpdatePayload;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = payload.org_id?.trim() ?? "";
  if (!(toolName && orgId)) {
    return NextResponse.json(
      { ok: false, error: "toolName and org_id are required." },
      { status: 400 }
    );
  }

  return forwardAgentRequest(
    `/agent/approval-policies/${encodeURIComponent(toolName)}?org_id=${encodeURIComponent(orgId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approval_mode: payload.approval_mode,
        enabled: payload.enabled,
      }),
    }
  );
}
