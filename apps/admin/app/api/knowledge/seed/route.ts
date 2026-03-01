import { NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const API_BASE_URL = SERVER_API_BASE_URL;

export async function POST(request: Request) {
  let payload: { org_id?: string };
  try {
    payload = (await request.json()) as { org_id?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON payload." },
      { status: 400 }
    );
  }

  const orgId = typeof payload.org_id === "string" ? payload.org_id.trim() : "";
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required." },
      { status: 400 }
    );
  }
  const token = await getServerAccessToken();

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(`${API_BASE_URL}/knowledge-documents/seed`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({ organization_id: orgId }),
    });

    const text = await response.text().catch(() => "");
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = {};
      }
    }

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof parsed === "object" &&
            parsed &&
            "detail" in (parsed as Record<string, unknown>)
              ? (parsed as Record<string, unknown>).detail
              : text || response.statusText,
        },
        { status: response.status }
      );
    }

    return NextResponse.json(parsed);
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
