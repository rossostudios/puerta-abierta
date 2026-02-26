import { type NextRequest, NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ guestId: string }> }
) {
  const { guestId } = await params;
  const token = await getServerAccessToken();

  if (!token) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const response = await fetch(
      `${API_BASE_URL}/guests/${encodeURIComponent(guestId)}/verification`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
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
