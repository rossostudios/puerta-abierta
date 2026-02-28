"use client";

import { Notification03Icon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { type NotificationListItem, normalizeNotification } from "@/lib/api";
import { toRelativeTimeIntl } from "@/lib/format";
import { useVisibilityPollingInterval } from "@/lib/hooks/use-visibility-polling";
import { cn } from "@/lib/utils";

const LIST_LIMIT = 8;

const CATEGORY_COLORS: Record<string, string> = {
  collections: "bg-[var(--status-warning-fg)]",
  maintenance: "bg-primary/80",
  messaging: "bg-[var(--status-info-fg)]",
  applications: "bg-foreground/60",
  system: "bg-[var(--status-danger-fg)]",
};

type NotificationBellProps = {
  locale: string;
  orgId: string | null;
};

export function NotificationBell({ locale, orgId }: NotificationBellProps) {
  "use no memo";
  const isEn = locale === "en-US";
  const router = useRouter();

  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const pollInterval = useVisibilityPollingInterval({
    enabled: !!orgId,
    foregroundMs: 60_000,
    backgroundMs: 120_000,
  });

  type NotificationsData = {
    notifications: NotificationListItem[];
    unreadCount: number;
  };

  const {
    data,
    isPending: loading,
    isError,
    refetch,
  } = useQuery<NotificationsData>({
    queryKey: ["notifications", orgId],
    queryFn: async () => {
      if (!orgId) {
        return { notifications: [], unreadCount: 0 };
      }
      const fallbackMsg = isEn
        ? "Could not load notifications."
        : "No se pudieron cargar las notificaciones.";
      const encodedOrgId = encodeURIComponent(orgId);

      const [countRes, listRes] = await Promise.all([
        fetch(`/api/notifications/unread-count?org_id=${encodedOrgId}`, {
          method: "GET",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        fetch(
          `/api/notifications?org_id=${encodedOrgId}&status=all&limit=${LIST_LIMIT}`,
          {
            method: "GET",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        ),
      ]);

      const countPayload = (await countRes.json().catch(() => ({}))) as {
        unread?: unknown;
        error?: unknown;
      };
      const listPayload = (await listRes.json().catch(() => ({}))) as {
        data?: unknown[];
        error?: unknown;
      };

      let anyFailed = false;
      if (!countRes.ok) {
        anyFailed = true;
      }
      if (!listRes.ok) {
        anyFailed = true;
      }
      if (anyFailed) {
        let countError = "";
        if (typeof countPayload.error === "string") {
          countError = countPayload.error;
        }
        let listError = "";
        if (typeof listPayload.error === "string") {
          listError = listPayload.error;
        }
        let message = fallbackMsg;
        if (countError) {
          message = countError;
        } else if (listError) {
          message = listError;
        }
        throw new Error(message);
      }

      const unreadCount =
        typeof countPayload.unread === "number" ? countPayload.unread : 0;

      let rows: unknown[] = [];
      if (Array.isArray(listPayload.data)) {
        rows = listPayload.data;
      }
      const notifications = rows
        .map(normalizeNotification)
        .filter((item): item is NotificationListItem => Boolean(item));

      return { notifications, unreadCount };
    },
    enabled: !!orgId,
    refetchInterval: pollInterval,
  });

  const notifications = data?.notifications ?? [];
  const unreadCount = data?.unreadCount ?? 0;
  const error = isError;

  const hasUnread = unreadCount > 0;
  const unreadDisplay = unreadCount > 99 ? "99+" : String(unreadCount);

  const markRead = useCallback(
    async (notification: NotificationListItem) => {
      if (!orgId) return;
      if (!notification.read_at) {
        const optimisticReadAt = new Date().toISOString();
        queryClient.setQueryData(
          ["notifications", orgId],
          (prev: NotificationsData | undefined) => {
            if (!prev) return prev;
            return {
              notifications: prev.notifications.map((row) =>
                row.id === notification.id
                  ? { ...row, read_at: optimisticReadAt }
                  : row
              ),
              unreadCount: Math.max(0, prev.unreadCount - 1),
            };
          }
        );
      }

      try {
        await fetch(
          `/api/notifications/${encodeURIComponent(notification.id)}/read?org_id=${encodeURIComponent(orgId)}`,
          {
            method: "POST",
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        );
      } catch {
        // Keep optimistic read state and refresh on next poll.
      }

      if (notification.link_path) {
        setOpen(false);
        router.push(notification.link_path);
      }
    },
    [orgId, queryClient, router]
  );

  const markAllRead = useCallback(async () => {
    if (!orgId || markingAll) return;
    const optimisticReadAt = new Date().toISOString();
    setMarkingAll(true);
    queryClient.setQueryData(
      ["notifications", orgId],
      (prev: NotificationsData | undefined) => {
        if (!prev) return prev;
        return {
          notifications: prev.notifications.map((item) =>
            item.read_at ? item : { ...item, read_at: optimisticReadAt }
          ),
          unreadCount: 0,
        };
      }
    );

    try {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ org_id: orgId }),
      });
      if (!response.ok) {
        refetch();
      }
      setMarkingAll(false);
    } catch {
      refetch();
      setMarkingAll(false);
    }
  }, [markingAll, orgId, queryClient, refetch]);

  const renderedRows = useMemo(() => {
    return notifications.map((notification) => {
      const isRead = Boolean(notification.read_at);
      const dotColor = isRead
        ? "bg-muted-foreground/30"
        : (CATEGORY_COLORS[notification.category] ?? "bg-primary/80");

      return (
        <button
          className={cn(
            "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
            !isRead && "bg-primary/[0.03]"
          )}
          key={notification.id}
          onClick={() => markRead(notification)}
          type="button"
        >
          <div className="flex shrink-0 pt-1">
            <span className={cn("h-2 w-2 rounded-full", dotColor)} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p
                className={cn(
                  "truncate text-[13px] leading-5",
                  isRead
                    ? "text-muted-foreground"
                    : "font-medium text-foreground"
                )}
              >
                {notification.title || notification.event_type}
              </p>
              <span className="shrink-0 text-[11px] text-muted-foreground/70">
                {toRelativeTimeIntl(
                  notification.occurred_at ?? notification.created_at,
                  locale
                )}
              </span>
            </div>
            <p className="mt-0.5 truncate text-muted-foreground text-xs">
              {notification.body || notification.category}
            </p>
          </div>
        </button>
      );
    });
  }, [locale, markRead, notifications]);

  return (
    <PopoverRoot onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        className={cn(
          "relative flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-foreground/62 transition-all duration-150",
          "hover:border-border/80 hover:bg-background hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
        title={isEn ? "Notifications" : "Notificaciones"}
      >
        <Icon icon={Notification03Icon} size={18} />
        {hasUnread ? (
          <span className="absolute -top-1 -right-1 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 font-semibold text-[10px] text-white ring-2 ring-background">
            {unreadDisplay}
          </span>
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
        <div className="flex items-center justify-between border-border/60 border-b px-4 py-3">
          <h3 className="font-semibold text-sm">
            {isEn ? "Notifications" : "Notificaciones"}
          </h3>
          {hasUnread ? (
            <button
              className="font-medium text-muted-foreground text-xs transition-colors hover:text-foreground disabled:opacity-50"
              disabled={markingAll}
              onClick={markAllRead}
              type="button"
            >
              {isEn ? "Mark all read" : "Marcar todo leído"}
            </button>
          ) : null}
        </div>

        <div className="max-h-[360px] overflow-y-auto">
          {loading && notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              {isEn ? "Loading notifications..." : "Cargando notificaciones..."}
            </div>
          ) : error ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              {isEn
                ? "Could not load notifications."
                : "No se pudieron cargar."}
            </div>
          ) : notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              {isEn ? "No notifications" : "Sin notificaciones"}
            </div>
          ) : (
            renderedRows
          )}
        </div>

        <div className="border-border/60 border-t px-4 py-2.5">
          <Link
            className="block w-full text-center font-medium text-primary text-xs transition-colors hover:text-primary/80"
            href="/module/notifications"
            onClick={() => setOpen(false)}
          >
            {isEn ? "View all notifications" : "Ver todas las notificaciones"}
          </Link>
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
