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
const BACKEND_PROXY_PATH_PREFIX = "/api/backend";
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
  const res = await fetchWithTransientRetry(
    buildAuthedFetchUrl(path),
    requestInit
  );

  if (!res.ok) {
    const parsed = await parseApiErrorResponse(res);
    const message = parsed.message ?? `API ${res.status}`;
    if (
      !options?.suppressErrorEvent &&
      res.status !== 401 &&
      typeof window !== "undefined"
    ) {
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

function buildAuthedFetchUrl(path: string): string {
  if (ABSOLUTE_HTTP_URL_RE.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (typeof window !== "undefined") {
    return `${BACKEND_PROXY_PATH_PREFIX}${normalizedPath}`;
  }
  return `${AUTHED_API_BASE}${normalizedPath}`;
}

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const RATE_LIMIT_STATUS_CODE = 429;
const MAX_GET_RETRIES = 2;
const TRANSIENT_RETRY_BASE_MS = 250;
const TRANSIENT_RETRY_JITTER_MS = 500;
const RATE_LIMIT_FALLBACK_DELAY_MS = 1500;
const RATE_LIMIT_MAX_WAIT_MS = 30_000;
const RATE_LIMIT_WAIT_SECONDS_RE = /wait\s+for\s+(\d+)\s*s/i;
const RATE_LIMIT_WAIT_MILLISECONDS_RE = /wait\s+for\s+(\d+)\s*ms/i;
const ABSOLUTE_HTTP_URL_RE = /^https?:\/\//i;
const rateLimitCooldownByPath = new Map<string, number>();

type ParsedApiError = {
  message?: string;
  code?: string;
  retryable?: boolean;
  requestId?: string;
};

function resolvePathKey(input: RequestInfo | URL): string {
  const value =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  try {
    const base =
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin;
    return new URL(value, base).pathname;
  } catch {
    return value;
  }
}

async function waitForRateLimitCooldown(pathKey: string): Promise<void> {
  const until = rateLimitCooldownByPath.get(pathKey) ?? 0;
  const now = Date.now();
  if (until <= now) return;
  await sleep(until - now);
}

function rememberRateLimitCooldown(pathKey: string, delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs <= 0) return;
  const clamped = Math.min(delayMs, RATE_LIMIT_MAX_WAIT_MS);
  const until = Date.now() + clamped;
  const existing = rateLimitCooldownByPath.get(pathKey) ?? 0;
  rateLimitCooldownByPath.set(pathKey, Math.max(existing, until));
}

function clearRateLimitCooldown(pathKey: string): void {
  rateLimitCooldownByPath.delete(pathKey);
}

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RATE_LIMIT_MAX_WAIT_MS);
  }

  const targetTime = Date.parse(trimmed);
  if (!Number.isFinite(targetTime)) return null;
  return Math.min(Math.max(0, targetTime - Date.now()), RATE_LIMIT_MAX_WAIT_MS);
}

function parseBodyRateLimitMs(bodyText: string): number | null {
  const secondMatch = bodyText.match(RATE_LIMIT_WAIT_SECONDS_RE);
  if (secondMatch) {
    const seconds = Number.parseInt(secondMatch[1], 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, RATE_LIMIT_MAX_WAIT_MS);
    }
  }

  const msMatch = bodyText.match(RATE_LIMIT_WAIT_MILLISECONDS_RE);
  if (msMatch) {
    const milliseconds = Number.parseInt(msMatch[1], 10);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) {
      return Math.min(milliseconds, RATE_LIMIT_MAX_WAIT_MS);
    }
  }

  return null;
}

async function getRateLimitDelayMs(response: Response): Promise<number> {
  const fromRetryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
  if (fromRetryAfter !== null) return fromRetryAfter;

  const fromRateLimitAfter = parseRetryAfterMs(
    response.headers.get("x-ratelimit-after")
  );
  if (fromRateLimitAfter !== null) return fromRateLimitAfter;

  try {
    const bodyText = await response.clone().text();
    const fromBody = parseBodyRateLimitMs(bodyText);
    if (fromBody !== null) return fromBody;
  } catch {
    // Body parsing is best-effort.
  }

  return RATE_LIMIT_FALLBACK_DELAY_MS;
}

async function fetchWithTransientRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const pathKey = resolvePathKey(input);
  let attempt = 0;

  while (true) {
    if (method === "GET") {
      await waitForRateLimitCooldown(pathKey);
    }

    const response = await fetch(input, init);
    if (method !== "GET") {
      return response;
    }

    if (response.status === RATE_LIMIT_STATUS_CODE) {
      const delayMs = await getRateLimitDelayMs(response);
      rememberRateLimitCooldown(pathKey, delayMs);
      if (attempt >= MAX_GET_RETRIES) {
        return response;
      }
      attempt += 1;
      await sleep(
        delayMs + Math.floor(Math.random() * TRANSIENT_RETRY_JITTER_MS)
      );
      continue;
    }

    if (TRANSIENT_STATUS_CODES.has(response.status)) {
      if (attempt >= MAX_GET_RETRIES) {
        return response;
      }
      attempt += 1;
      await sleep(
        TRANSIENT_RETRY_BASE_MS +
          Math.floor(Math.random() * TRANSIENT_RETRY_JITTER_MS)
      );
      continue;
    }

    if (response.ok) {
      clearRateLimitCooldown(pathKey);
    }
    return response;
  }
}

async function parseApiErrorResponse(
  response: Response
): Promise<ParsedApiError> {
  const requestId = response.headers.get("x-request-id") ?? undefined;
  const retryAfter = response.headers.get("retry-after");

  let rawText = "";
  try {
    rawText = await response.text();
  } catch {
    rawText = "";
  }

  let message = rawText.trim() || `Request failed (${response.status})`;
  let code: string | undefined;
  let retryable: boolean | undefined =
    response.status === RATE_LIMIT_STATUS_CODE ||
    TRANSIENT_STATUS_CODES.has(response.status) ||
    retryAfter !== null;

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
      const detail = body.detail ?? body.error ?? body.message ?? undefined;
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
