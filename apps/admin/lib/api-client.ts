/**
 * Client-side API helpers with global error notifications.
 *
 * Dispatches a custom "pa-api-error" event on `window` for non-auth errors,
 * which the ApiErrorToaster component listens to.
 */

const API_ERROR_EVENT = "pa-api-error";

export type ApiErrorDetail = {
  status: number;
  path: string;
  message: string;
  code?: string;
  retryable?: boolean;
  requestId?: string;
};

/** Dispatch a global API error notification. */
export function dispatchApiError(detail: ApiErrorDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(API_ERROR_EVENT, { detail }));
}

/** Subscribe to global API error events. Returns an unsubscribe function. */
export function onApiError(
  handler: (detail: ApiErrorDetail) => void
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (e: Event) => {
    handler((e as CustomEvent<ApiErrorDetail>).detail);
  };
  window.addEventListener(API_ERROR_EVENT, listener);
  return () => window.removeEventListener(API_ERROR_EVENT, listener);
}

/**
 * Thin wrapper around `fetch` for client-side API calls.
 * Dispatches a global error event on non-2xx (except 401, which is handled
 * by auth redirects).
 */
export async function clientFetch<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetchWithTransientRetry(url, init);

  if (!response.ok) {
    const parsed = await parseApiErrorResponse(response);
    const message = parsed.message ?? `Request failed (${response.status})`;

    // Skip toast for auth errors (redirects handle those)
    if (response.status !== 401) {
      dispatchApiError({
        status: response.status,
        path: new URL(url, window.location.origin).pathname,
        message,
        code: parsed.code,
        retryable: parsed.retryable,
        requestId: parsed.requestId,
      });
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// authedFetch — client-side API calls with auth token (Clerk only)
// ---------------------------------------------------------------------------

import { getClerkClientAccessToken } from "@/lib/auth/client-access-token";

const AUTHED_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/v1";
const CLIENT_TOKEN_SKEW_MS = 30_000;

let cachedClientToken: { token: string | null; expiresAt: number } | null =
  null;

export async function getClientAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedClientToken && now < cachedClientToken.expiresAt) {
    return cachedClientToken.token;
  }

  const clerkToken = await getClerkClientAccessToken();
  if (clerkToken) {
    cachedClientToken = {
      token: clerkToken,
      expiresAt: now + CLIENT_TOKEN_SKEW_MS,
    };
    return clerkToken;
  }
  // Do not cache null tokens. Clerk client auth can be temporarily unavailable
  // during startup/hydration; caching null causes authenticated requests to send
  // no bearer token for the entire cache window.
  cachedClientToken = null;
  return null;
}

/**
 * Client-side fetch that automatically attaches the active session JWT.
 * Used by module managers for direct backend API calls.
 */
export async function authedFetch<T>(
  path: string,
  init?: RequestInit,
  options?: { suppressErrorEvent?: boolean }
): Promise<T> {
  const token = await getClientAccessToken();

  const requestInit: RequestInit = {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  };
  const res = await fetchWithTransientRetry(`${AUTHED_API_BASE}${path}`, requestInit);

  if (!res.ok) {
    const parsed = await parseApiErrorResponse(res);
    const message = parsed.message ?? `API ${res.status}`;
    if (!options?.suppressErrorEvent && res.status !== 401 && typeof window !== "undefined") {
      dispatchApiError({
        status: res.status,
        path,
        message,
        code: parsed.code,
        retryable: parsed.retryable,
        requestId: parsed.requestId,
      });
    }
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);

type ParsedApiError = {
  message?: string;
  code?: string;
  retryable?: boolean;
  requestId?: string;
};

async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  let response = await fetch(input, init);

  if (method !== "GET" || !TRANSIENT_STATUS_CODES.has(response.status)) {
    return response;
  }

  await sleep(250 + Math.floor(Math.random() * 500));
  response = await fetch(input, init);
  return response;
}

async function parseApiErrorResponse(response: Response): Promise<ParsedApiError> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const retryAfter = response.headers.get("retry-after");

  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    rawText = "";
  }

  let message =
    rawText.trim() || `Request failed (${response.status})`;
  let code: string | undefined;
  let retryable: boolean | undefined =
    TRANSIENT_STATUS_CODES.has(response.status) || retryAfter !== null;

  if (rawText) {
    try {
      const body = JSON.parse(rawText) as {
        detail?: unknown;
        error?: unknown;
        message?: unknown;
        code?: unknown;
        retryable?: unknown;
        request_id?: unknown;
      };
      const detail =
        body.detail ?? body.error ?? body.message ?? undefined;
      if (typeof detail === "string" && detail.trim()) {
        message = detail.trim();
      }
      if (typeof body.code === "string") code = body.code;
      if (typeof body.retryable === "boolean") retryable = body.retryable;
      if (!requestId && typeof body.request_id === "string") {
        return {
          message: withRequestId(message, body.request_id),
          code,
          retryable,
          requestId: body.request_id,
        };
      }
    } catch {
      // non-JSON response body
    }
  }

  return {
    message: withRequestId(message, requestId),
    code,
    retryable,
    requestId,
  };
}

function withRequestId(message: string, requestId?: string): string {
  if (!requestId) return message;
  return `${message} (request: ${requestId})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
