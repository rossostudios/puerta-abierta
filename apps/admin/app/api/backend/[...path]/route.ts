import { NextResponse } from "next/server";
import { getServerAccessToken } from "@/lib/auth/server-access-token";
import { SERVER_API_BASE_URL } from "@/lib/server-api-base";

const PROXY_TIMEOUT_MS = 30_000;

type ProxyRouteContext = {
  params: Promise<{ path: string[] }>;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
]);
const TRAILING_SLASH_RE = /\/+$/;

function isBodylessMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function buildUpstreamUrl(pathSegments: string[], search: string): string {
  const base = SERVER_API_BASE_URL.replace(TRAILING_SLASH_RE, "");
  const path = pathSegments
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${path}${search}`;
}

function filterHeaders(headers: Headers): Headers {
  const filtered = new Headers();
  for (const [key, value] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    filtered.set(key, value);
  }
  return filtered;
}

async function proxyBackendRequest(
  request: Request,
  context: ProxyRouteContext
): Promise<Response> {
  const { path = [] } = await context.params;
  if (!Array.isArray(path) || path.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Missing backend path." },
      { status: 400 }
    );
  }

  let authorization = request.headers.get("authorization");
  if (!authorization) {
    const token = await getServerAccessToken();
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    authorization = `Bearer ${token}`;
  }

  const requestUrl = new URL(request.url);
  const upstreamUrl = buildUpstreamUrl(path, requestUrl.search);
  const upstreamHeaders = filterHeaders(request.headers);
  upstreamHeaders.set("authorization", authorization);
  if (!upstreamHeaders.has("accept")) {
    upstreamHeaders.set("accept", "application/json");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: upstreamHeaders,
      body: isBodylessMethod(request.method)
        ? undefined
        : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: filterHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return NextResponse.json(
        { ok: false, error: "Backend request timed out" },
        { status: 504 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

export function GET(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function POST(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function PUT(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function PATCH(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function DELETE(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function OPTIONS(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}

export function HEAD(request: Request, context: ProxyRouteContext) {
  return proxyBackendRequest(request, context);
}
