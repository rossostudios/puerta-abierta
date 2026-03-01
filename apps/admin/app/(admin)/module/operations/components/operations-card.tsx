"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";
import type { OperationsItem } from "../hooks/use-operations-portfolio";

type OperationsCardProps = {
  item: OperationsItem;
  isEn: boolean;
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  submitted: "bg-muted text-muted-foreground",
  acknowledged: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  scheduled: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  closed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  cancelled: "bg-muted text-muted-foreground/60",
};

const PRIORITY_COLORS: Record<string, string> = {
  emergency: "text-red-600 dark:text-red-400",
  urgent: "text-red-600 dark:text-red-400",
  high: "text-amber-600 dark:text-amber-400",
  medium: "text-muted-foreground",
  low: "text-muted-foreground/60",
};

function relativeTime(dateStr: string | null, isEn: boolean): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(Math.abs(diff) / 60_000);
  const isFuture = diff < 0;

  if (mins < 60) {
    if (isFuture) return isEn ? `in ${mins}m` : `en ${mins}m`;
    return isEn ? `${mins}m ago` : `hace ${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    if (isFuture) return isEn ? `in ${hours}h` : `en ${hours}h`;
    return isEn ? `${hours}h ago` : `hace ${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (isFuture) return isEn ? `in ${days}d` : `en ${days}d`;
  return isEn ? `${days}d ago` : `hace ${days}d`;
}

export function OperationsCard({ item, isEn }: OperationsCardProps) {
  const [expanded, setExpanded] = useState(false);

  const colorClass = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending;
  const priorityColor =
    PRIORITY_COLORS[item.priority] ?? PRIORITY_COLORS.medium;
  const location = [item.propertyName, item.unitName]
    .filter(Boolean)
    .join(" \u00B7 ");

  const timeLabel = item.dueAt
    ? relativeTime(item.dueAt, isEn)
    : relativeTime(item.createdAt, isEn);

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="glass-inner overflow-hidden rounded-2xl transition-shadow hover:shadow-[var(--shadow-soft)]"
      initial={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.3, ease: EASING }}
    >
      {/* Collapsed row */}
      <button
        className="flex w-full items-start gap-3 p-4 text-left sm:p-5"
        onClick={() => setExpanded((p) => !p)}
        type="button"
      >
        {/* Emoji avatar */}
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/60 text-lg">
          {item.emoji}
        </span>

        {/* Center content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium text-foreground text-sm tracking-tight">
              {item.title}
            </h3>

            {/* Status badge */}
            <span
              className={cn(
                "ml-auto shrink-0 rounded-full px-2 py-0.5 font-medium text-[10px] uppercase tracking-wide",
                colorClass
              )}
            >
              {item.statusLabel}
            </span>

            {/* Overdue dot */}
            {item.isOverdue && (
              <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
            )}
          </div>

          <p className="mt-0.5 truncate text-muted-foreground/60 text-xs">
            {location ||
              (item.kind === "task"
                ? isEn
                  ? "No property assigned"
                  : "Sin propiedad asignada"
                : isEn
                  ? "General request"
                  : "Solicitud general")}
          </p>

          {/* Metrics row */}
          <div className="mt-2.5 flex items-center gap-1.5 text-muted-foreground text-xs">
            <span
              className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 font-semibold text-[10px] uppercase tracking-wider",
                item.kind === "task"
                  ? "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
              )}
            >
              {item.kind === "task"
                ? isEn
                  ? "Task"
                  : "Tarea"
                : isEn
                  ? "Maint"
                  : "Mant"}
            </span>
            <span className="text-muted-foreground/30">&middot;</span>
            <span className={cn("tabular-nums", priorityColor)}>
              {item.priorityLabel}
            </span>
            {timeLabel && (
              <>
                <span className="text-muted-foreground/30">&middot;</span>
                <span
                  className={cn(
                    "tabular-nums",
                    item.isOverdue
                      ? "text-red-600 dark:text-red-400"
                      : "text-muted-foreground"
                  )}
                >
                  {item.isOverdue ? (isEn ? "Overdue" : "Vencido") : timeLabel}
                </span>
              </>
            )}
          </div>
        </div>
      </button>

      {/* Expandable detail panel */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASING }}
          >
            <div className="border-border/40 border-t px-4 py-4 sm:px-5">
              {item.kind === "task" ? (
                <TaskDetails isEn={isEn} item={item} />
              ) : (
                <MaintenanceDetails isEn={isEn} item={item} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/* Task Expanded Details                                               */
/* ------------------------------------------------------------------ */

function TaskDetails({ item, isEn }: { item: OperationsItem; isEn: boolean }) {
  return (
    <>
      {item.description && (
        <p className="mb-3 text-muted-foreground text-xs leading-relaxed">
          {item.description}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        <DetailItem
          label={isEn ? "Due date" : "Fecha l\u00edmite"}
          value={item.dueAt || (isEn ? "No due date" : "Sin fecha")}
        />
        <DetailItem
          label={isEn ? "Assignee" : "Asignado a"}
          value={item.assigneeName || (isEn ? "Unassigned" : "Sin asignar")}
        />
        {item.checklistTotal > 0 && (
          <DetailItem
            label={isEn ? "Checklist" : "Lista"}
            tone={
              item.checklistDone === item.checklistTotal ? "success" : "warning"
            }
            value={`${item.checklistDone}/${item.checklistTotal}`}
          />
        )}
        <DetailItem
          label={isEn ? "Priority" : "Prioridad"}
          value={item.priorityLabel}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionChip
          label={isEn ? "Mark complete" : "Marcar completa"}
          prompt={
            isEn
              ? `Mark task "${item.title}" as complete`
              : `Marcar tarea "${item.title}" como completada`
          }
        />
        <ActionChip
          label={isEn ? "Reassign" : "Reasignar"}
          prompt={
            isEn
              ? `Reassign task "${item.title}"`
              : `Reasignar tarea "${item.title}"`
          }
        />
        <ActionChip
          label={isEn ? "Update priority" : "Cambiar prioridad"}
          prompt={
            isEn
              ? `Update priority for task "${item.title}"`
              : `Cambiar prioridad de tarea "${item.title}"`
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Maintenance Expanded Details                                        */
/* ------------------------------------------------------------------ */

function MaintenanceDetails({
  item,
  isEn,
}: {
  item: OperationsItem;
  isEn: boolean;
}) {
  return (
    <>
      {item.description && (
        <p className="mb-3 text-muted-foreground text-xs leading-relaxed">
          {item.description}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 text-xs">
        {item.category && (
          <DetailItem
            label={isEn ? "Category" : "Categor\u00eda"}
            value={item.category}
          />
        )}
        <DetailItem
          label={isEn ? "Urgency" : "Urgencia"}
          tone={item.isUrgent ? "danger" : undefined}
          value={item.priorityLabel}
        />
        {item.submittedBy && (
          <DetailItem
            label={isEn ? "Submitted by" : "Reportado por"}
            value={item.submittedBy}
          />
        )}
        {item.scheduledDate && (
          <DetailItem
            label={isEn ? "Scheduled" : "Programado"}
            value={item.scheduledDate}
          />
        )}
        {item.resolutionNotes && (
          <DetailItem
            label={isEn ? "Resolution" : "Resoluci\u00f3n"}
            value={item.resolutionNotes}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <ActionChip
          label={isEn ? "Dispatch vendor" : "Despachar proveedor"}
          prompt={
            isEn
              ? `Dispatch a vendor for maintenance request "${item.title}"`
              : `Despachar proveedor para solicitud "${item.title}"`
          }
        />
        <ActionChip
          label={isEn ? "Escalate" : "Escalar"}
          prompt={
            isEn
              ? `Escalate maintenance request "${item.title}"`
              : `Escalar solicitud de mantenimiento "${item.title}"`
          }
        />
        <ActionChip
          label={isEn ? "Mark resolved" : "Marcar resuelta"}
          prompt={
            isEn
              ? `Mark maintenance request "${item.title}" as resolved`
              : `Marcar solicitud "${item.title}" como resuelta`
          }
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Shared sub-components                                               */
/* ------------------------------------------------------------------ */

function DetailItem({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div>
      <p className="text-muted-foreground/60">{label}</p>
      <p
        className={cn(
          "font-medium tabular-nums",
          tone === "success" && "text-emerald-600 dark:text-emerald-400",
          tone === "warning" && "text-amber-600 dark:text-amber-400",
          tone === "danger" && "text-red-600 dark:text-red-400",
          !tone && "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ActionChip({ label, prompt }: { label: string; prompt: string }) {
  return (
    <Link
      className="rounded-full border border-border/50 px-3 py-1.5 text-muted-foreground text-xs transition-colors hover:border-foreground/20 hover:text-foreground"
      href={`/app/agents?prompt=${encodeURIComponent(prompt)}`}
    >
      {label}
    </Link>
  );
}
