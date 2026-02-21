import { fetchJson } from "@casaora/shared-api/client";
import type { components, paths } from "@casaora/shared-api/types";

import { getApiBaseUrl, getDefaultOrgId } from "@/lib/config";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";

export type HealthResponse =
  paths["/health"]["get"]["responses"]["200"]["content"]["application/json"];
export type MeResponse =
  paths["/me"]["get"]["responses"]["200"]["content"]["application/json"];
export type Task = components["schemas"]["Task"];
export type TaskStatus = components["schemas"]["TaskStatus"];
export type TaskListResponse =
  paths["/tasks"]["get"]["responses"]["200"]["content"]["application/json"];
export type TaskDetailResponse =
  paths["/tasks/{task_id}"]["get"]["responses"]["200"]["content"]["application/json"];
export type TaskItem = {
  id: string;
  task_id: string;
  label: string;
  sort_order: number;
  is_required: boolean;
  is_completed: boolean;
  photo_urls?: string[] | null;
};

export async function fetchHealth(): Promise<HealthResponse> {
  return fetchJson<HealthResponse>("/health", {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
  });
}

export async function fetchMe(): Promise<MeResponse> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured.");
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("No active Supabase session.");
  }

  return fetchJson<MeResponse>("/me", {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
}

export async function resolveActiveOrgId(): Promise<string> {
  const defaultOrgId = getDefaultOrgId();
  if (defaultOrgId) return defaultOrgId;

  const me = await fetchMe();
  const memberships = Array.isArray(me.memberships) ? me.memberships : [];
  const orgId = memberships
    .map((membership) =>
      typeof membership?.organization_id === "string"
        ? membership.organization_id.trim()
        : ""
    )
    .find((value) => value.length > 0);

  if (!orgId) {
    throw new Error(
      "No organization found in /me. Set EXPO_PUBLIC_DEFAULT_ORG_ID in .env.local."
    );
  }

  return orgId;
}

export async function listTasks(params: {
  orgId: string;
  status?: TaskStatus;
  assignedUserId?: string;
  limit?: number;
}): Promise<Task[]> {
  const payload = await fetchJson<TaskListResponse>("/tasks", {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
    query: {
      org_id: params.orgId,
      status: params.status,
      assigned_user_id: params.assignedUserId,
      limit: params.limit ?? 100,
    },
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });

  return Array.isArray(payload.data) ? payload.data : [];
}

export async function getTask(taskId: string): Promise<TaskDetailResponse> {
  return fetchJson<TaskDetailResponse>(`/tasks/${encodeURIComponent(taskId)}`, {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });
}

export async function completeTask(
  taskId: string,
  completionNotes?: string
): Promise<TaskDetailResponse> {
  return fetchJson<TaskDetailResponse>(
    `/tasks/${encodeURIComponent(taskId)}/complete`,
    {
      baseUrl: getApiBaseUrl(),
      method: "POST",
      body:
        completionNotes && completionNotes.trim().length > 0
          ? { completion_notes: completionNotes.trim() }
          : undefined,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );
}

export async function listTaskItems(taskId: string): Promise<TaskItem[]> {
  const payload = await fetchJson<{ data?: TaskItem[] }>(
    `/tasks/${encodeURIComponent(taskId)}/items`,
    {
      baseUrl: getApiBaseUrl(),
      method: "GET",
      includeJsonContentType: false,
      query: { limit: 500 },
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );

  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.label.localeCompare(b.label);
  });
}

export async function updateTaskItem(
  taskId: string,
  itemId: string,
  patch: {
    is_completed?: boolean;
    label?: string;
    is_required?: boolean;
    sort_order?: number;
    photo_urls?: string[];
  }
): Promise<TaskItem> {
  return fetchJson<TaskItem>(
    `/tasks/${encodeURIComponent(taskId)}/items/${encodeURIComponent(itemId)}`,
    {
      baseUrl: getApiBaseUrl(),
      method: "PATCH",
      body: patch,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );
}

export async function createTaskItem(
  taskId: string,
  input: { label: string; is_required?: boolean; sort_order?: number }
): Promise<TaskItem> {
  return fetchJson<TaskItem>(`/tasks/${encodeURIComponent(taskId)}/items`, {
    baseUrl: getApiBaseUrl(),
    method: "POST",
    body: {
      label: input.label,
      is_required: input.is_required ?? true,
      sort_order: input.sort_order,
    },
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });
}

// ── Reservations ──

export type Reservation = {
  id: string;
  guest_name?: string | null;
  property_name?: string | null;
  unit_name?: string | null;
  check_in: string;
  check_out: string;
  status: string;
  total_amount?: number | null;
  currency?: string | null;
  guests_count?: number | null;
  source?: string | null;
};

export async function listReservations(params: {
  orgId: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<Reservation[]> {
  const payload = await fetchJson<{ data?: Reservation[] }>("/reservations", {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
    query: {
      org_id: params.orgId,
      from: params.from,
      to: params.to,
      limit: params.limit ?? 50,
    },
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });

  return Array.isArray(payload.data) ? payload.data : [];
}

// ── Messages ──

export type MessageThread = {
  id: string;
  guest_name?: string | null;
  guest_phone?: string | null;
  channel?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number | null;
};

export type Message = {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound";
  body: string;
  channel?: string | null;
  created_at: string;
};

export async function listMessageThreads(params: {
  orgId: string;
  limit?: number;
}): Promise<MessageThread[]> {
  const payload = await fetchJson<{ data?: MessageThread[] }>(
    "/messaging/threads",
    {
      baseUrl: getApiBaseUrl(),
      method: "GET",
      includeJsonContentType: false,
      query: {
        org_id: params.orgId,
        limit: params.limit ?? 50,
      },
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );

  return Array.isArray(payload.data) ? payload.data : [];
}

export async function listThreadMessages(params: {
  orgId: string;
  threadId: string;
  limit?: number;
}): Promise<Message[]> {
  const payload = await fetchJson<{ data?: Message[] }>(
    `/messaging/threads/${encodeURIComponent(params.threadId)}/messages`,
    {
      baseUrl: getApiBaseUrl(),
      method: "GET",
      includeJsonContentType: false,
      query: {
        org_id: params.orgId,
        limit: params.limit ?? 100,
      },
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );

  return Array.isArray(payload.data) ? payload.data : [];
}

export async function sendThreadMessage(params: {
  orgId: string;
  threadId: string;
  body: string;
}): Promise<void> {
  await fetchJson(`/messaging/threads/${encodeURIComponent(params.threadId)}/messages`, {
    baseUrl: getApiBaseUrl(),
    method: "POST",
    body: {
      org_id: params.orgId,
      body: params.body,
    },
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });
}

// ── Notifications ──

export type Notification = {
  id: string;
  event_type: string;
  category: string;
  severity: string;
  title: string;
  body: string;
  link_path?: string | null;
  read_at?: string | null;
  created_at?: string | null;
};

export async function listNotifications(params: {
  orgId: string;
  status?: "all" | "read" | "unread";
  limit?: number;
}): Promise<Notification[]> {
  const payload = await fetchJson<{ data?: Notification[] }>("/notifications", {
    baseUrl: getApiBaseUrl(),
    method: "GET",
    includeJsonContentType: false,
    query: {
      org_id: params.orgId,
      status: params.status ?? "all",
      limit: params.limit ?? 50,
    },
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
    },
  });

  return Array.isArray(payload.data) ? payload.data : [];
}

export async function markNotificationRead(params: {
  orgId: string;
  notificationId: string;
}): Promise<void> {
  await fetchJson(
    `/notifications/${encodeURIComponent(params.notificationId)}/read`,
    {
      baseUrl: getApiBaseUrl(),
      method: "POST",
      body: { org_id: params.orgId },
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
      },
    }
  );
}

// ── Helpers ──

async function getAccessToken(): Promise<string> {
  if (!isSupabaseConfigured) {
    throw new Error("Supabase is not configured.");
  }

  const supabase = getSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new Error("No active Supabase session.");
  }

  return session.access_token;
}
