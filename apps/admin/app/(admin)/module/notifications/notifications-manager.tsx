"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { NotificationListItem, NotificationListResponse } from "@/lib/api";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 45_000;
const PAGE_LIMIT = 40;

type NotificationsManagerProps = {
  orgId: string;
  locale: string;
  initialStatus?: string;
  initialCategory?: string;
};

type StatusFilter = "all" | "unread" | "read";

function normalizeStatus(value: string | undefined): StatusFilter {
  switch (value) {
    case "unread":
    case "read":
      return value;
    default:
      return "all";
  }
}

function normalizeNotification(item: unknown): NotificationListItem | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;

  return {
    id,
    event_id: typeof row.event_id === "string" ? row.event_id : "",
    event_type: typeof row.event_type === "string" ? row.event_type : "",
    category: typeof row.category === "string" ? row.category : "system",
    severity: typeof row.severity === "string" ? row.severity : "info",
    title: typeof row.title === "string" ? row.title : "",
    body: typeof row.body === "string" ? row.body : "",
    link_path: typeof row.link_path === "string" ? row.link_path : null,
    source_table: typeof row.source_table === "string" ? row.source_table : null,
    source_id: typeof row.source_id === "string" ? row.source_id : null,
    payload:
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : {},
    read_at: typeof row.read_at === "string" ? row.read_at : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    occurred_at: typeof row.occurred_at === "string" ? row.occurred_at : null,
  };
}

function toRelativeTime(value: string | null | undefined, locale: string): string {
  if (!value) return "";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const deltaSeconds = Math.round((timestamp - Date.now()) / 1000);
  const abs = Math.abs(deltaSeconds);
  const rtf = new Intl.RelativeTimeFormat(locale === "en-US" ? "en" : "es", {
    numeric: "auto",
  });

  if (abs < 60) return rtf.format(deltaSeconds, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSeconds / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(deltaSeconds / 3600), "hour");
  return rtf.format(Math.round(deltaSeconds / 86_400), "day");
}

export function NotificationsManager({
  orgId,
  locale,
  initialStatus,
  initialCategory,
}: NotificationsManagerProps) {
  const isEn = locale === "en-US";
  const [status, setStatus] = useState<StatusFilter>(() => normalizeStatus(initialStatus));
  const [category, setCategory] = useState<string>(
    initialCategory?.trim() || "all"
  );
  const [rows, setRows] = useState<NotificationListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      if (row.category) set.add(row.category);
    }
    if (category !== "all") set.add(category);
    return ["all", ...Array.from(set).sort()];
  }, [category, rows]);

  const loadNotifications = useCallback(
    async (options?: { cursor?: string; append?: boolean; silent?: boolean }) => {
      const cursor = options?.cursor;
      const append = options?.append === true;
      const silent = options?.silent === true;

      if (append) {
        setLoadingMore(true);
      } else if (!silent) {
        setLoading(true);
      }

      try {
        const qs = new URLSearchParams();
        qs.set("org_id", orgId);
        qs.set("limit", String(PAGE_LIMIT));
        qs.set("status", status);
        if (category !== "all") qs.set("category", category);
        if (cursor) qs.set("cursor", cursor);

        const listResponse = await fetch(`/api/notifications?${qs.toString()}`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const listPayloadRaw = (await listResponse.json().catch(() => ({}))) as
          | NotificationListResponse
          | { error?: unknown };

        if (!listResponse.ok) {
          const message =
            typeof (listPayloadRaw as { error?: unknown }).error === "string"
              ? ((listPayloadRaw as { error?: string }).error as string)
              : isEn
                ? "Could not load notifications."
                : "No se pudieron cargar las notificaciones.";
          throw new Error(message);
        }

        const listPayload = listPayloadRaw as NotificationListResponse;
        const parsedRows = Array.isArray(listPayload.data)
          ? listPayload.data
              .map(normalizeNotification)
              .filter((item): item is NotificationListItem => Boolean(item))
          : [];

        setRows((prev) => (append ? [...prev, ...parsedRows] : parsedRows));
        setNextCursor(
          typeof listPayload.next_cursor === "string"
            ? listPayload.next_cursor
            : null
        );
        setError(null);

        if (!append) {
          const unreadResponse = await fetch(
            `/api/notifications/unread-count?org_id=${encodeURIComponent(orgId)}`,
            {
              method: "GET",
              cache: "no-store",
              headers: { Accept: "application/json" },
            }
          );
          const unreadPayload = (await unreadResponse.json().catch(() => ({}))) as {
            unread?: unknown;
          };
          if (unreadResponse.ok) {
            setUnreadCount(
              typeof unreadPayload.unread === "number" ? unreadPayload.unread : 0
            );
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
      } finally {
        if (append) {
          setLoadingMore(false);
        } else if (!silent) {
          setLoading(false);
        }
      }
    },
    [category, isEn, orgId, status]
  );

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadNotifications({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [loadNotifications]);

  const markRead = useCallback(
    async (item: NotificationListItem) => {
      if (!item.id) return;
      if (!item.read_at) {
        const optimisticReadAt = new Date().toISOString();
        setRows((prev) =>
          prev.map((row) =>
            row.id === item.id ? { ...row, read_at: optimisticReadAt } : row
          )
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }

      try {
        await fetch(
          `/api/notifications/${encodeURIComponent(item.id)}/read?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "POST",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        );
      } catch {
        // Keep optimistic state. Poll will reconcile.
      }
    },
    [orgId]
  );

  const markAllRead = useCallback(async () => {
    const optimisticReadAt = new Date().toISOString();
    setRows((prev) =>
      prev.map((row) => (row.read_at ? row : { ...row, read_at: optimisticReadAt }))
    );
    setUnreadCount(0);

    try {
      await fetch("/api/notifications/read-all", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ org_id: orgId }),
      });
    } catch {
      loadNotifications({ silent: true });
    }
  }, [loadNotifications, orgId]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="h-9 min-w-[150px]"
            onChange={(event) => setStatus(normalizeStatus(event.target.value))}
            value={status}
          >
            <option value="all">{isEn ? "All" : "Todos"}</option>
            <option value="unread">{isEn ? "Unread" : "No leídos"}</option>
            <option value="read">{isEn ? "Read" : "Leídos"}</option>
          </Select>

          <Select
            className="h-9 min-w-[170px]"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {item === "all"
                  ? isEn
                    ? "All categories"
                    : "Todas las categorías"
                  : item}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {isEn ? "Unread" : "No leídas"}:{" "}
            <strong className="text-foreground">{unreadCount}</strong>
          </span>
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
            onClick={markAllRead}
            type="button"
          >
            {isEn ? "Mark all read" : "Marcar todo leído"}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-muted-foreground text-sm">
          {isEn ? "Loading notifications..." : "Cargando notificaciones..."}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-300/40 bg-red-50/40 px-4 py-8 text-center text-red-700 text-sm">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border/50 px-4 py-8 text-center text-muted-foreground text-sm">
          {isEn ? "No notifications found." : "No se encontraron notificaciones."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          {rows.map((item) => {
            const isRead = Boolean(item.read_at);
            const linkTarget = item.link_path || "/module/notifications";

            return (
              <div
                className={cn(
                  "border-border/50 border-b px-4 py-3 last:border-b-0",
                  !isRead && "bg-primary/[0.03]"
                )}
                key={item.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm",
                        isRead ? "text-muted-foreground" : "font-medium text-foreground"
                      )}
                    >
                      {item.title || item.event_type}
                    </p>
                    <p className="mt-0.5 text-muted-foreground text-xs">
                      {item.body || item.category}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground/80">
                      {toRelativeTime(item.occurred_at ?? item.created_at, locale)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isRead ? (
                      <button
                        className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted"
                        onClick={() => markRead(item)}
                        type="button"
                      >
                        {isEn ? "Mark read" : "Marcar leído"}
                      </button>
                    ) : null}
                    <Link
                      className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted"
                      href={linkTarget}
                      onClick={() => {
                        if (!isRead) markRead(item);
                      }}
                    >
                      {isEn ? "Open" : "Abrir"}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <button
            className="rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted disabled:opacity-60"
            disabled={loadingMore}
            onClick={() => loadNotifications({ cursor: nextCursor, append: true })}
            type="button"
          >
            {loadingMore
              ? isEn
                ? "Loading..."
                : "Cargando..."
              : isEn
                ? "Load more"
                : "Cargar más"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
