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
type NextRequestInit = RequestInit & {
  next?: {
    revalidate?: number;
    tags?: string[];
  };
};

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

export type NotificationListItem = {
  id: string;
  event_id: string;
  event_type: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  link_path?: string | null;
  source_table?: string | null;
  source_id?: string | null;
  payload?: Record<string, unknown>;
  read_at?: string | null;
  created_at?: string | null;
  occurred_at?: string | null;
};

export type NotificationListResponse = {
  data: NotificationListItem[];
  next_cursor?: string | null;
};

export type UnreadCountResponse = {
  unread: number;
};

export type NotificationRuleMetadataTrigger = {
  value: string;
  label_en: string;
  label_es: string;
  mode: string;
};

export type NotificationRuleMetadataResponse = {
  channels: string[];
  triggers: NotificationRuleMetadataTrigger[];
};

export type WorkflowRuleMetadataTrigger = {
  value: string;
  label_en: string;
  label_es: string;
};

export type WorkflowRuleMetadataAction = {
  value: string;
  label_en: string;
  label_es: string;
};

export type WorkflowRuleMetadataResponse = {
  engine_mode?: string;
  triggers: WorkflowRuleMetadataTrigger[];
  actions: WorkflowRuleMetadataAction[];
  config_schema_hints?: Record<string, unknown>;
};

const LIST_LIMIT_CAPS: Record<string, number> = {
  "/applications": 250,
  "/integration-events": 200,
  "/leases": 300,
  "/message-templates": 200,
  "/owner-statements": 200,
  "/properties": 500,
  "/units": 500,
};
const DYNAMIC_LIST_LIMIT_CAPS: Array<{ pattern: RegExp; cap: number }> = [
  { pattern: /^\/organizations\/[^/]+\/members$/, cap: 200 },
];

function applyListLimitCap(path: string, limit: number): number {
  const normalizedPath = path.split("?")[0] ?? path;
  const cap = LIST_LIMIT_CAPS[normalizedPath];
  if (cap !== undefined) {
    return Math.min(limit, cap);
  }

  const dynamicCap = DYNAMIC_LIST_LIMIT_CAPS.find((entry) =>
    entry.pattern.test(normalizedPath)
  )?.cap;
  if (dynamicCap !== undefined) {
    return Math.min(limit, dynamicCap);
  }
  return limit;
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

let pendingTokenRequest: Promise<string | null> | null = null;
let cachedAccessToken: { token: string | null; expiresAt: number } | null =
  null;

async function getAccessToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAccessToken && now < cachedAccessToken.expiresAt) {
    return cachedAccessToken.token;
  }

  // Dedup concurrent token requests so only one Supabase client/session
  // check runs at a time; others await its result.
  if (pendingTokenRequest) return pendingTokenRequest;
  pendingTokenRequest = (async () => {
    try {
      const supabase = await createSupabaseServerClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
      const expiresAt = data.session?.expires_at
        ? Math.max(0, data.session.expires_at * 1000 - SERVER_TOKEN_SKEW_MS)
        : now + SERVER_TOKEN_SKEW_MS;
      cachedAccessToken = { token, expiresAt };
      return token;
    } catch {
      cachedAccessToken = null;
      return null;
    } finally {
      pendingTokenRequest = null;
    }
  })();
  return pendingTokenRequest;
}

const TRANSIENT_STATUS_CODES = new Set([502, 503, 504]);
const RETRY_DELAY_MS = 1000;
const PUBLIC_CACHE_REVALIDATE_SECONDS = 120;
const FX_CACHE_REVALIDATE_SECONDS = 900;
const SERVER_TOKEN_SKEW_MS = 30_000;

async function doFetch(
  path: string,
  url: string,
  init?: NextRequestInit,
  options?: { includeAuth?: boolean }
): Promise<Response> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  const includeAuth = options?.includeAuth !== false;
  const signal =
    init?.signal && typeof AbortSignal.any === "function"
      ? AbortSignal.any([init.signal, controller.signal])
      : (init?.signal ?? controller.signal);
  try {
    const token = includeAuth ? await getAccessToken() : null;
    return await fetch(url, {
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
}

async function requestJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  init?: NextRequestInit,
  options?: { includeAuth?: boolean }
): Promise<T> {
  const url = buildUrl(path, query);
  const method = (init?.method ?? "GET").toUpperCase();

  let response = await doFetch(path, url, init, options);

  // Retry once on transient errors for safe (GET) requests
  if (
    method === "GET" &&
    TRANSIENT_STATUS_CODES.has(response.status)
  ) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await doFetch(path, url, init, options);
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

export async function fetchJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  init?: NextRequestInit
): Promise<T> {
  return requestJson(path, query, init, { includeAuth: true });
}

export async function fetchPublicJson<T>(
  path: string,
  query?: Record<string, QueryValue>,
  init?: NextRequestInit
): Promise<T> {
  return requestJson(path, query, init, { includeAuth: false });
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

export function fetchNotifications(
  orgId: string,
  params?: {
    limit?: number;
    cursor?: string;
    status?: "all" | "read" | "unread";
    category?: string;
  }
): Promise<NotificationListResponse> {
  return fetchJson<NotificationListResponse>("/notifications", {
    org_id: orgId,
    limit: params?.limit ?? 50,
    cursor: params?.cursor,
    status: params?.status ?? "all",
    category: params?.category,
  });
}

export function fetchNotificationUnreadCount(
  orgId: string
): Promise<UnreadCountResponse> {
  return fetchJson<UnreadCountResponse>("/notifications/unread-count", {
    org_id: orgId,
  });
}

export function fetchNotificationRulesMetadata(
  orgId: string
): Promise<NotificationRuleMetadataResponse> {
  return fetchJson<NotificationRuleMetadataResponse>(
    "/notification-rules/metadata",
    {
      org_id: orgId,
    }
  );
}

export function fetchWorkflowRulesMetadata(
  orgId: string
): Promise<WorkflowRuleMetadataResponse> {
  return fetchJson<WorkflowRuleMetadataResponse>("/workflow-rules/metadata", {
    org_id: orgId,
  });
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

export type KpiDashboard = {
  organization_id?: string;
  collection_rate?: number;
  total_collections?: number;
  paid_collections?: number;
  avg_days_late?: number;
  occupancy_rate?: number;
  total_units?: number;
  active_leases?: number;
  revenue_per_unit?: number;
  total_paid_amount?: number;
  avg_maintenance_response_hours?: number | null;
  median_maintenance_response_hours?: number | null;
  open_maintenance_tasks?: number;
  expiring_leases_60d?: number;
};

export function fetchKpiDashboard(orgId: string): Promise<KpiDashboard> {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const to = today.toISOString().slice(0, 10);

  return fetchJson<KpiDashboard>("/reports/kpi-dashboard", {
    org_id: orgId,
    from_date: from,
    to_date: to,
  });
}

// ── Phase 4: Occupancy Forecast ──

export type OccupancyForecastMonth = {
  month: string;
  occupancy_pct: number;
  is_forecast: boolean;
  units_occupied?: number;
  total_units?: number;
};

export type OccupancyForecastResponse = {
  organization_id?: string;
  historical_avg_occupancy_pct: number;
  total_units: number;
  months: OccupancyForecastMonth[];
};

export function fetchOccupancyForecast(
  orgId: string,
  monthsAhead = 3
): Promise<OccupancyForecastResponse> {
  return fetchJson<OccupancyForecastResponse>("/reports/occupancy-forecast", {
    org_id: orgId,
    months_ahead: monthsAhead,
  });
}

// ── Phase 4: Anomaly Alerts ──

export type AnomalyAlert = {
  id: string;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description?: string;
  detected_at: string;
};

export type AnomalyAlertsResponse = {
  organization_id?: string;
  data: AnomalyAlert[];
  count: number;
};

export function fetchAnomalyAlerts(
  orgId: string
): Promise<AnomalyAlertsResponse> {
  const today = new Date().toISOString().slice(0, 10);
  return fetchJson<AnomalyAlertsResponse>("/reports/anomalies", {
    org_id: orgId,
    from_date: today,
    to_date: today,
  });
}

// ── Phase 4: Agent Performance ──

export type AgentPerformanceStats = {
  organization_id?: string;
  period_days: number;
  total_conversations: number;
  total_messages: number;
  avg_tool_calls_per_response: number;
  model_usage: { model: string; count: number }[];
  per_agent: { agent_name: string; message_count: number }[];
};

export function fetchAgentPerformance(
  orgId: string
): Promise<AgentPerformanceStats> {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(new Date().getTime() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return fetchJson<AgentPerformanceStats>("/reports/agent-performance", {
    org_id: orgId,
    from_date: from,
    to_date: today,
  });
}

// ── Phase 4: Revenue Trend ──

export type RevenueTrendMonth = {
  month: string;
  revenue: number;
};

export type RevenueTrendResponse = {
  organization_id?: string;
  months: RevenueTrendMonth[];
};

export function fetchRevenueTrend(
  orgId: string
): Promise<RevenueTrendResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const from = new Date(new Date().getTime() - 180 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return fetchJson<RevenueTrendResponse>("/reports/revenue-trend", {
    org_id: orgId,
    from_date: from,
    to_date: today,
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

export function fetchPublicListings(params?: {
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
  return fetchPublicJson<{ data?: Record<string, unknown>[] }>(
    "/public/listings",
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
    },
    {
      cache: "force-cache",
      next: { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS },
    }
  );
}

export function fetchPublicListing(
  slug: string
): Promise<Record<string, unknown>> {
  return fetchPublicJson<Record<string, unknown>>(
    `/public/listings/${encodeURIComponent(slug)}`,
    undefined,
    {
      cache: "force-cache",
      next: { revalidate: PUBLIC_CACHE_REVALIDATE_SECONDS },
    }
  );
}

/** Fetch the cached USD→PYG exchange rate from the backend. */
export async function fetchUsdPygRate(): Promise<number> {
  try {
    const data = await fetchPublicJson<{ usd_pyg: number }>(
      "/public/fx/usd-pyg",
      undefined,
      {
        cache: "force-cache",
        next: { revalidate: FX_CACHE_REVALIDATE_SECONDS },
      }
    );
    if (data.usd_pyg && data.usd_pyg > 0) return data.usd_pyg;
  } catch {
    /* fall through to default */
  }
  return 7500; // fallback
}

export function fetchPublicPaymentInfo(
  referenceCode: string
): Promise<Record<string, unknown>> {
  return fetchPublicJson<Record<string, unknown>>(
    `/public/payment/${encodeURIComponent(referenceCode)}`,
    undefined,
    { cache: "no-store" }
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

export type AgentApproval = {
  id: string;
  organization_id: string;
  chat_id: string | null;
  agent_slug: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  status:
    | "pending"
    | "approved"
    | "rejected"
    | "executed"
    | "execution_failed";
  review_note: string | null;
  execution_result: Record<string, unknown> | null;
  created_at: string;
  reviewed_at: string | null;
  executed_at: string | null;
};

export type AgentApprovalPolicy = {
  organization_id: string;
  tool_name: "create_row" | "update_row" | "delete_row";
  approval_mode: "required" | "auto";
  enabled: boolean;
  updated_by?: string | null;
  updated_at?: string | null;
};

export type AgentInboxItem = {
  id: string;
  kind: "approval" | "anomaly" | "task" | "lease" | "application";
  priority: "critical" | "high" | "medium" | "low";
  title: string;
  body: string;
  link_path: string | null;
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

export function fetchAgentApprovals(orgId: string): Promise<{
  organization_id?: string;
  data?: AgentApproval[];
  count?: number;
}> {
  return fetchJson("/agent/approvals", { org_id: orgId });
}

export function reviewAgentApproval(
  orgId: string,
  approvalId: string,
  action: "approve" | "reject",
  note?: string | null
): Promise<Record<string, unknown>> {
  return fetchJson(
    `/agent/approvals/${encodeURIComponent(approvalId)}/${action}`,
    { org_id: orgId },
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ note: typeof note === "string" ? note : null }),
    }
  );
}

export function fetchAgentApprovalPolicies(orgId: string): Promise<{
  organization_id?: string;
  data?: AgentApprovalPolicy[];
}> {
  return fetchJson("/agent/approval-policies", { org_id: orgId });
}

export function updateAgentApprovalPolicy(
  orgId: string,
  toolName: "create_row" | "update_row" | "delete_row",
  payload: { approval_mode?: "required" | "auto"; enabled?: boolean }
): Promise<Record<string, unknown>> {
  return fetchJson(
    `/agent/approval-policies/${encodeURIComponent(toolName)}`,
    { org_id: orgId },
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
}

export function fetchAgentInbox(
  orgId: string,
  limit = 60
): Promise<{ organization_id?: string; data?: AgentInboxItem[]; count?: number }> {
  return fetchJson("/agent/inbox", { org_id: orgId, limit });
}
