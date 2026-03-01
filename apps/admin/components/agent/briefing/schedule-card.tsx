"use client";

import { motion } from "motion/react";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CARD, EASING, SectionLabel, type Stats } from "./helpers";

type TimelineEntry = {
  id: string;
  time: string;
  label: string;
  property: string;
  status: "complete" | "in_progress" | "upcoming";
  sortKey: number;
};

function parseTimeMinutes(t?: string): number {
  if (!t) return 0;
  // Handle both "HH:MM" and ISO timestamp formats
  const timeStr = t.includes("T")
    ? (t.split("T")[1]?.slice(0, 5) ?? "00:00")
    : t;
  const [h, m] = timeStr.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatTime12h(t?: string): string {
  if (!t || t === "—") return "—";
  const timeStr = t.includes("T")
    ? (t.split("T")[1]?.slice(0, 5) ?? "00:00")
    : t;
  const [h, m] = timeStr.split(":").map(Number);
  if (h === undefined || m === undefined) return t;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

const STATUS_CONFIG = {
  complete: {
    dot: "bg-emerald-500 border-emerald-500",
    badge: "text-emerald-600 dark:text-emerald-400",
    label: { en: "COMPLETE", es: "COMPLETADO" },
    symbol: "\u2713",
  },
  in_progress: {
    dot: "bg-blue-500 border-blue-500",
    badge: "text-blue-600 dark:text-blue-400",
    label: { en: "IN PROGRESS", es: "EN PROGRESO" },
    symbol: "\u25CF",
  },
  upcoming: {
    dot: "bg-transparent border-muted-foreground/30",
    badge: "text-muted-foreground/50",
    label: { en: "UPCOMING", es: "PRÓXIMO" },
    symbol: "\u25CB",
  },
} as const;

export function ScheduleCard({ stats, isEn }: { stats: Stats; isEn: boolean }) {
  const entries = useMemo(() => {
    const now = nowMinutes();
    const items: TimelineEntry[] = [];

    // Departures
    for (const dep of stats.todays_departures ?? []) {
      const timeKey = parseTimeMinutes(dep.check_out_time);
      items.push({
        id: `dep-${dep.unit_code}-${dep.guest_name}`,
        time: formatTime12h(dep.check_out_time),
        label: `${dep.guest_name} checks out`,
        property: dep.property_name || dep.unit_code,
        status: timeKey <= now ? "complete" : "upcoming",
        sortKey: timeKey,
      });
    }

    // Tasks
    for (const task of stats.todays_tasks ?? []) {
      const timeKey = parseTimeMinutes(task.due_at);
      let status: TimelineEntry["status"] = "upcoming";
      if (task.status === "done") status = "complete";
      else if (task.status === "in_progress") status = "in_progress";

      const loc = task.property_name || task.unit_code || "";
      items.push({
        id: `task-${task.title}-${task.due_at}`,
        time: formatTime12h(task.due_at),
        label: task.title,
        property: loc,
        status,
        sortKey: timeKey,
      });
    }

    // Arrivals
    for (const arr of stats.todays_arrivals ?? []) {
      const timeKey = parseTimeMinutes(arr.check_in_time);
      items.push({
        id: `arr-${arr.unit_code}-${arr.guest_name}`,
        time: formatTime12h(arr.check_in_time),
        label: `${arr.guest_name} checks in`,
        property: arr.property_name || arr.unit_code,
        status: timeKey <= now ? "complete" : "upcoming",
        sortKey: timeKey,
      });
    }

    items.sort((a, b) => a.sortKey - b.sortKey);
    return items;
  }, [stats]);

  if (entries.length === 0) return null;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(CARD, "space-y-4 p-5")}
      initial={{ opacity: 0, y: 12 }}
      transition={{ delay: 0.2, duration: 0.4, ease: EASING }}
    >
      <SectionLabel>{isEn ? "Today's Schedule" : "Agenda de Hoy"}</SectionLabel>

      <div className="space-y-0">
        {entries.map((entry, i) => {
          const cfg = STATUS_CONFIG[entry.status];

          return (
            <motion.div
              animate={{ opacity: 1, x: 0 }}
              className="flex items-center gap-3 py-2.5"
              initial={{ opacity: 0, x: -6 }}
              key={entry.id}
              transition={{
                delay: 0.25 + i * 0.06,
                duration: 0.3,
                ease: EASING,
              }}
            >
              {/* Time */}
              <span className="w-[72px] shrink-0 text-right font-medium text-[12px] text-foreground/70 tabular-nums">
                {entry.time}
              </span>

              {/* Status dot */}
              <div className="relative flex flex-col items-center">
                <div
                  className={cn("h-2.5 w-2.5 rounded-full border-2", cfg.dot)}
                />
                {i < entries.length - 1 && (
                  <div className="absolute top-3 h-5 w-px bg-muted-foreground/15" />
                )}
              </div>

              {/* Description */}
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[13px] text-foreground/90">
                  {entry.label}
                </p>
                {entry.property && (
                  <p className="text-[11px] text-muted-foreground/50">
                    {entry.property}
                  </p>
                )}
              </div>

              {/* Status badge */}
              <span
                className={cn(
                  "shrink-0 font-medium text-[10px] tracking-wider",
                  cfg.badge
                )}
              >
                {cfg.symbol} {isEn ? cfg.label.en : cfg.label.es}
              </span>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}
