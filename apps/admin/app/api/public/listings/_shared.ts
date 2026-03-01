import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const API_BASE_URL = SERVER_API_BASE_URL;

function formatBackendError(text: string): string {
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const detail = parsed.detail ?? parsed.message ?? parsed.error ?? text;
    if (typeof detail === "string") {
      return detail;
    }
    return JSON.stringify(detail);
  } catch {
    return text;
  }
}

export async function proxyMarketplaceRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      const detail = formatBackendError(text);
      const suffix = detail ? `: ${detail}` : "";
      return Response.json(
        {
          ok: false,
          error: `Marketplace backend error (${response.status})${suffix}`,
        },
        { status: response.status }
      );
    }

    const payload = (await response.json()) as unknown;
    return Response.json(payload, { status: response.status });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `Marketplace backend is unreachable: ${err.message}`
            : "Marketplace backend is unreachable.",
      },
      { status: 502 }
    );
  }
}
