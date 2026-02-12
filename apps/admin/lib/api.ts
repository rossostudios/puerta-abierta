import { createSupabaseServerClient } from "@/lib/supabase/server";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";
const DEFAULT_API_TIMEOUT_MS = 15_000;

const parsedApiTimeoutMs = Number(
  process.env.API_TIMEOUT_MS ?? DEFAULT_API_TIMEOUT_MS
);
const API_TIMEOUT_MS =
  Number.isFinite(parsedApiTimeoutMs) && parsedApiTimeoutMs > 0
    ? parsedApiTimeoutMs
    : DEFAULT_API_TIMEOUT_MS;

if (
  process.env.NODE_ENV === "production" &&
  !process.env.NEXT_PUBLIC_API_BASE_URL
) {
  throw new Error(
    "Missing NEXT_PUBLIC_API_BASE_URL in production. Set it in your deployment environment."
  );
}

type QueryValue = string | number | boolean | undefined | null;

export type OrganizationMembership = {
  id?: string;
  organization_id?: string;
  role?: string;
  user_id?: string;
};

export type MePayload = {
  user?: Record<string, unknown>;
  memberships?: OrganizationMembership[];
  organizations?: Record<string, unknown>[];
};

export type OperationsSummary = {
  organization_id?: string;
  from?: string;
  to?: string;
  turnovers_due?: number;
  turnovers_completed_on_time?: number;
  turnover_on_time_rate?: number;
  open_tasks?: number;
  overdue_tasks?: number;
  sla_breached_tasks?: number;
  reservations_upcoming_check_in?: number;
  reservations_upcoming_check_out?: number;
};
const LIST_LIMIT_CAPS: Record<string, number> = {
  "/properties": 500,
  "/units": 500,
};

function applyListLimitCap(path: string, limit: number): number {
  const normalizedPath = path.split("?")[0] ?? path;
  const cap = LIST_LIMIT_CAPS[normalizedPath];
  if (cap === undefined) return limit;
  return Math.min(limit, cap);
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${API_BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function fetchJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, controller.signal])
      : (init?.signal ?? controller.signal);
  try {
    const token = await getAccessToken();
    response = await fetch(buildUrl(path, query), {
      cache: "no-store",
      ...init,
      signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `API request timed out for ${path} after ${API_TIMEOUT_MS}ms.`
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `API fetch failed for ${path}. Is the backend running at ${API_BASE_URL}? (${message})`
    );
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (!response.ok) {
    let detailsText = "";
    try {
      detailsText = await response.text();
    } catch {
      detailsText = "";
    }

    let detailMessage = detailsText;
    if (detailsText) {
      try {
        const parsed = JSON.parse(detailsText) as {
          detail?: unknown;
          error?: unknown;
          message?: unknown;
        };
        const detail =
          parsed?.detail ?? parsed?.error ?? parsed?.message ?? detailsText;

        if (typeof detail === "string") {
          detailMessage = detail;
        } else if (Array.isArray(detail)) {
          // FastAPI validation errors are usually an array with `msg` fields.
          const messages = detail
            .map((item) => {
              if (!item || typeof item !== "object") return "";
              const record = item as Record<string, unknown>;
              return typeof record.msg === "string" ? record.msg : "";
            })
            .filter(Boolean);
          if (messages.length) detailMessage = messages.join("; ");
        }
      } catch {
        // Keep the raw response text when it isn't JSON.
      }
    }

    const suffix = detailMessage ? `: ${detailMessage.slice(0, 240)}` : "";
    throw new Error(
      `API request failed (${response.status}) for ${path}${suffix}`
    );
  }

  return (await response.json()) as T;
}

export function getApiBaseUrl(): string {
  return API_BASE_URL;
}

export async function fetchList(
  path: string,
  orgId: string,
  limit = 50,
  extraQuery?: Record<string, QueryValue>
): Promise<unknown[]> {
  const boundedLimit = applyListLimitCap(path, limit);
  const data = await fetchJson<{ data?: unknown[] }>(path, {
    org_id: orgId,
    limit: boundedLimit,
    ...(extraQuery ?? {}),
  });
  return data.data ?? [];
}

export async function fetchOrganizations(limit = 50): Promise<unknown[]> {
  const data = await fetchJson<{ data?: unknown[] }>("/organizations", {
    limit,
  });
  return data.data ?? [];
}

export function fetchOwnerSummary(
  path: string,
  orgId: string
): Promise<Record<string, unknown>> {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  return fetchJson<Record<string, unknown>>(path, { org_id: orgId, from, to });
}

export function fetchMe(): Promise<MePayload> {
  return fetchJson<MePayload>("/me");
}

export function fetchOperationsSummary(
  orgId: string,
  range?: { from?: string; to?: string }
): Promise<OperationsSummary> {
  const today = new Date();
  const defaultFrom = range?.from ?? today.toISOString().slice(0, 10);
  const defaultTo =
    range?.to ??
    new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

  return fetchJson<OperationsSummary>("/reports/operations-summary", {
    org_id: orgId,
    from: defaultFrom,
    to: defaultTo,
  });
}

export function postJson(
  path: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  return fetchJson(path, undefined, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function patchJson(
  path: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  return fetchJson(path, undefined, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function deleteJson(path: string): Promise<unknown> {
  return fetchJson(path, undefined, {
    method: "DELETE",
  });
}

export function fetchPublicMarketplaceListings(params?: {
  city?: string;
  neighborhood?: string;
  q?: string;
  propertyType?: string;
  furnished?: boolean;
  petPolicy?: string;
  minParking?: number;
  minMonthly?: number;
  maxMonthly?: number;
  minMoveIn?: number;
  maxMoveIn?: number;
  minBedrooms?: number;
  minBathrooms?: number;
  orgId?: string;
  limit?: number;
}): Promise<{ data?: Record<string, unknown>[] }> {
  return fetchJson<{ data?: Record<string, unknown>[] }>(
    "/public/marketplace/listings",
    {
      city: params?.city,
      neighborhood: params?.neighborhood,
      q: params?.q,
      property_type: params?.propertyType,
      furnished: params?.furnished,
      pet_policy: params?.petPolicy,
      min_parking: params?.minParking,
      min_monthly: params?.minMonthly,
      max_monthly: params?.maxMonthly,
      min_move_in: params?.minMoveIn,
      max_move_in: params?.maxMoveIn,
      min_bedrooms: params?.minBedrooms,
      min_bathrooms: params?.minBathrooms,
      org_id: params?.orgId,
      limit: params?.limit ?? 60,
    }
  );
}

export function fetchPublicMarketplaceListing(
  slug: string
): Promise<Record<string, unknown>> {
  return fetchJson<Record<string, unknown>>(
    `/public/marketplace/listings/${encodeURIComponent(slug)}`
  );
}

export type AgentDefinition = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon_key?: string;
  is_active?: boolean;
};

export type AgentChatSummary = {
  id: string;
  org_id: string;
  agent_id: string;
  agent_slug: string;
  agent_name: string;
  agent_icon_key?: string;
  title: string;
  is_archived: boolean;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  latest_message_preview?: string | null;
};

export type AgentChatMessage = {
  id: string;
  chat_id: string;
  org_id: string;
  role: "user" | "assistant";
  content: string;
  tool_trace?: Array<{
    tool?: string;
    ok?: boolean;
    preview?: string;
    args?: Record<string, unknown>;
  }> | null;
  model_used?: string | null;
  fallback_used?: boolean;
  created_at: string;
};

export function fetchAgentDefinitions(orgId: string): Promise<{
  organization_id?: string;
  data?: AgentDefinition[];
}> {
  return fetchJson("/agent/agents", { org_id: orgId });
}

export function fetchAgentChats(
  orgId: string,
  params?: { archived?: boolean; limit?: number }
): Promise<{ organization_id?: string; data?: AgentChatSummary[] }> {
  return fetchJson("/agent/chats", {
    org_id: orgId,
    archived: params?.archived ?? false,
    limit: params?.limit ?? 30,
  });
}

export function createAgentChat(payload: {
  org_id: string;
  agent_slug: string;
  title?: string;
}): Promise<AgentChatSummary> {
  return postJson("/agent/chats", payload) as Promise<AgentChatSummary>;
}

export function fetchAgentChat(
  orgId: string,
  chatId: string
): Promise<AgentChatSummary> {
  return fetchJson(`/agent/chats/${encodeURIComponent(chatId)}`, {
    org_id: orgId,
  });
}

export function fetchAgentChatMessages(
  orgId: string,
  chatId: string,
  limit = 120
): Promise<{
  organization_id?: string;
  chat_id?: string;
  data?: AgentChatMessage[];
}> {
  return fetchJson(`/agent/chats/${encodeURIComponent(chatId)}/messages`, {
    org_id: orgId,
    limit,
  });
}

export function sendAgentChatMessage(
  orgId: string,
  chatId: string,
  payload: {
    message: string;
    allow_mutations?: boolean;
    confirm_write?: boolean;
  }
): Promise<Record<string, unknown>> {
  return fetchJson(
    `/agent/chats/${encodeURIComponent(chatId)}/messages`,
    { org_id: orgId },
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: payload.message,
        allow_mutations: payload.allow_mutations === true,
        confirm_write: payload.confirm_write === true,
      }),
    }
  );
}

export function archiveAgentChat(
  orgId: string,
  chatId: string
): Promise<unknown> {
  return fetchJson(
    `/agent/chats/${encodeURIComponent(chatId)}/archive`,
    {
      org_id: orgId,
    },
    {
      method: "POST",
    }
  );
}

export function restoreAgentChat(
  orgId: string,
  chatId: string
): Promise<unknown> {
  return fetchJson(
    `/agent/chats/${encodeURIComponent(chatId)}/restore`,
    {
      org_id: orgId,
    },
    {
      method: "POST",
    }
  );
}

export function deleteAgentChat(
  orgId: string,
  chatId: string
): Promise<unknown> {
  return fetchJson(
    `/agent/chats/${encodeURIComponent(chatId)}`,
    {
      org_id: orgId,
    },
    {
      method: "DELETE",
    }
  );
}
