import type { StatusTone } from "@/components/ui/status-badge";
import { humanizeKey } from "@/lib/format";

export type UnitRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  property_name?: string | null;
};

export type TaskRow = {
  id: string;
  title?: string | null;
  type?: string | null;
  status?: string | null;
  priority?: string | null;
  due_at?: string | null;
  sla_due_at?: string | null;
  sla_breached_at?: string | null;
  completed_at?: string | null;
  description?: string | null;
  automation_source?: string | null;
  auto_generated?: boolean | null;

  assigned_user_id?: string | null;

  unit_id?: string | null;
  unit_name?: string | null;

  property_id?: string | null;
  property_name?: string | null;

  reservation_id?: string | null;

  checklist_total?: number | null;
  checklist_completed?: number | null;
  checklist_required_total?: number | null;
  checklist_required_remaining?: number | null;
};

export { asNumber, asOptionalString, asString } from "@/lib/module-helpers";

export function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return false;
}

export function shortId(value: string): string {
  const text = value.trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

export function taskStatusActions(
  status: string
): { kind: string; next?: string }[] {
  const normalized = status.trim().toLowerCase();
  if (normalized === "todo") {
    return [
      { kind: "status", next: "in_progress" },
      { kind: "status", next: "cancelled" },
    ];
  }
  if (normalized === "in_progress") {
    return [
      { kind: "complete" },
      { kind: "status", next: "todo" },
      { kind: "status", next: "cancelled" },
    ];
  }
  return [];
}

export function localizedTaskStatusLabel(
  isEn: boolean,
  status: string
): string {
  const normalized = status.trim().toLowerCase();
  if (!isEn) {
    if (normalized === "todo") return "Pendiente";
    if (normalized === "in_progress") return "En progreso";
    if (normalized === "done") return "Hecha";
    if (normalized === "cancelled") return "Cancelada";
  }
  if (normalized === "todo") return "To do";
  if (normalized === "in_progress") return "In progress";
  if (normalized === "done") return "Done";
  if (normalized === "cancelled") return "Cancelled";
  return status;
}

export function localizedTaskActionLabel(
  isEn: boolean,
  kind: string,
  next?: string
): string {
  if (kind === "complete") return isEn ? "Complete" : "Completar";

  if (next === "in_progress") return isEn ? "Start" : "Iniciar";
  if (next === "todo") return isEn ? "Back to todo" : "Volver";
  if (next === "cancelled") return isEn ? "Cancel" : "Cancelar";
  return next ?? kind;
}

export function localizedPriorityLabel(
  isEn: boolean,
  priority: string
): string {
  const normalized = priority.trim().toLowerCase();
  if (isEn) return humanizeKey(normalized) || "Normal";
  if (normalized === "low") return "Baja";
  if (normalized === "medium") return "Media";
  if (normalized === "high") return "Alta";
  if (normalized === "urgent") return "Urgente";
  return normalized || "normal";
}

export function priorityTone(priority: string): StatusTone {
  const normalized = priority.trim().toLowerCase();
  if (normalized === "urgent") return "danger";
  if (normalized === "high") return "warning";
  if (normalized === "low") return "info";
  return "neutral";
}

export function localizedTaskTypeLabel(isEn: boolean, value: string): string {
  const normalized = value.trim().toLowerCase();
  if (isEn) return humanizeKey(normalized);
  if (normalized === "cleaning") return "Limpieza";
  if (normalized === "maintenance") return "Mantenimiento";
  if (normalized === "check_in") return "Check-in";
  if (normalized === "check_out") return "Check-out";
  if (normalized === "inspection") return "Inspección";
  if (normalized === "custom") return "Personalizada";
  return humanizeKey(normalized);
}

export function formatDueLabel(
  locale: "es-PY" | "en-US",
  dueAt: string | null
): string {
  if (!dueAt) return "-";
  const date = new Date(dueAt);
  if (Number.isNaN(date.valueOf())) return dueAt;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

export function statusBadgeTone(status: string): StatusTone {
  const normalized = status.trim().toLowerCase();
  if (normalized === "done") return "success";
  if (normalized === "cancelled") return "danger";
  if (normalized === "in_progress") return "warning";
  if (normalized === "todo") return "warning";
  return "neutral";
}

export const BOARD_LANES = [
  { key: "todo", status: "todo" },
  { key: "in_progress", status: "in_progress" },
  { key: "done", status: "done" },
] as const;

export const STATUS_OPTIONS = [
  "todo",
  "in_progress",
  "done",
  "cancelled",
] as const;

export const TYPE_OPTIONS = [
  "cleaning",
  "maintenance",
  "check_in",
  "check_out",
  "inspection",
  "custom",
] as const;

export const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"] as const;
