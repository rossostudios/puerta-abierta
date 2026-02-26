import { type NextRequest, NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("org_id")?.trim() || "";
  if (!orgId) {
    return NextResponse.json(
      { ok: false, error: "org_id is required" },
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
    const response = await fetch(
      `${API_BASE_URL}/billing/current?org_id=${encodeURIComponent(orgId)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json(
        { ok: false, error: text || response.statusText },
        { status: response.status }
      );
    }

    const payload = (await response.json()) as unknown;
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 502 }
    );
  }
}
