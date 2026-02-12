"use client";

import { Notification03Icon } from "@hugeicons/core-free-icons";
import { useCallback, useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type NotificationCategory =
  | "reservation"
  | "task"
  | "message"
  | "finance"
  | "system";

type NotificationItem = {
  id: string;
  category: NotificationCategory;
  title: string;
  description: string;
  time: string;
  read: boolean;
};

const CATEGORY_COLORS: Record<NotificationCategory, string> = {
  reservation: "bg-[var(--status-info-fg)]",
  task: "bg-[var(--status-warning-fg)]",
  message: "bg-primary/80",
  finance: "bg-foreground/55",
  system: "bg-[var(--status-danger-fg)]",
};

const SAMPLE_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "1",
    category: "reservation",
    title: "New reservation #4821",
    description: "Casa del Sol · Check-in Mar 15",
    time: "2m ago",
    read: false,
  },
  {
    id: "2",
    category: "task",
    title: "Task overdue: Deep clean",
    description: "Unit 3B · Due yesterday",
    time: "1h ago",
    read: false,
  },
  {
    id: "3",
    category: "message",
    title: "Message from Carlos P.",
    description: '"¿A qué hora es el check-in?"',
    time: "3h ago",
    read: false,
  },
  {
    id: "4",
    category: "system",
    title: "Channel sync failed",
    description: "Airbnb connection timed out",
    time: "5h ago",
    read: true,
  },
  {
    id: "5",
    category: "finance",
    title: "Owner statement ready",
    description: "February 2026 · 3 properties",
    time: "1d ago",
    read: true,
  },
];

export function NotificationBell({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const [notifications, setNotifications] = useState(SAMPLE_NOTIFICATIONS);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const hasUnread = unreadCount > 0;

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  }, []);

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
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-background" />
        ) : null}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
        {/* Header */}
        <div className="flex items-center justify-between border-border/60 border-b px-4 py-3">
          <h3 className="font-semibold text-sm">
            {isEn ? "Notifications" : "Notificaciones"}
          </h3>
          {hasUnread ? (
            <button
              className="font-medium text-muted-foreground text-xs transition-colors hover:text-foreground"
              onClick={markAllRead}
              type="button"
            >
              {isEn ? "Mark all read" : "Marcar todo leído"}
            </button>
          ) : null}
        </div>

        {/* Notification Items */}
        <div className="max-h-[360px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground text-sm">
              {isEn ? "No notifications" : "Sin notificaciones"}
            </div>
          ) : (
            notifications.map((notification) => (
              <button
                className={cn(
                  "flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                  !notification.read && "bg-primary/[0.03]"
                )}
                key={notification.id}
                onClick={() => markRead(notification.id)}
                type="button"
              >
                {/* Category dot */}
                <div className="flex shrink-0 pt-1">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      notification.read
                        ? "bg-muted-foreground/30"
                        : CATEGORY_COLORS[notification.category]
                    )}
                  />
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={cn(
                        "truncate text-[13px] leading-5",
                        notification.read
                          ? "text-muted-foreground"
                          : "font-medium text-foreground"
                      )}
                    >
                      {notification.title}
                    </p>
                    <span className="shrink-0 text-[11px] text-muted-foreground/70">
                      {notification.time}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-muted-foreground text-xs">
                    {notification.description}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 ? (
          <div className="border-border/60 border-t px-4 py-2.5">
            <button
              className="w-full text-center font-medium text-primary text-xs transition-colors hover:text-primary/80"
              type="button"
            >
              {isEn
                ? "View all notifications →"
                : "Ver todas las notificaciones →"}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </PopoverRoot>
  );
}
