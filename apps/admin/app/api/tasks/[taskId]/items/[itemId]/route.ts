import { type NextRequest, NextResponse } from "next/server";

import { getServerAccessToken } from "@/lib/auth/server-access-token";

import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const API_BASE_URL = SERVER_API_BASE_URL;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string; itemId: string }> }
) {
  const { taskId, itemId } = await params;
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
      `${API_BASE_URL}/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
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
