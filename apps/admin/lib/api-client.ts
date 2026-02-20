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
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      const detail = body?.detail ?? body?.error ?? body?.message ?? undefined;
      if (typeof detail === "string") message = detail;
    } catch {
      // non-JSON response
    }

    // Skip toast for auth errors (redirects handle those)
    if (response.status !== 401) {
      dispatchApiError({
        status: response.status,
        path: new URL(url, window.location.origin).pathname,
        message,
      });
    }

    throw new Error(message);
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// authedFetch — client-side API calls with Supabase auth token
// ---------------------------------------------------------------------------

import { createBrowserClient } from "@supabase/ssr";

const AUTHED_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/v1";
const CLIENT_TOKEN_SKEW_MS = 30_000;

type BrowserSupabaseClient = ReturnType<typeof createBrowserClient>;

let browserSupabaseClient: BrowserSupabaseClient | null = null;
let cachedClientToken: { token: string | null; expiresAt: number } | null =
  null;

function getBrowserSupabaseClient(): BrowserSupabaseClient {
  if (!browserSupabaseClient) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!(supabaseUrl && supabaseAnonKey)) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
      );
    }
    browserSupabaseClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return browserSupabaseClient;
}

async function getClientAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedClientToken && now < cachedClientToken.expiresAt) {
    return cachedClientToken.token;
  }

  const supabase = getBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token ?? null;
  const expiresAtMs = session?.expires_at
    ? Math.max(0, session.expires_at * 1000 - CLIENT_TOKEN_SKEW_MS)
    : now + CLIENT_TOKEN_SKEW_MS;
  cachedClientToken = { token, expiresAt: expiresAtMs };
  return token;
}

/**
 * Client-side fetch that automatically attaches the Supabase JWT.
 * Used by module managers for direct backend API calls.
 */
export async function authedFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const token = await getClientAccessToken();

  const res = await fetch(`${AUTHED_API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}
