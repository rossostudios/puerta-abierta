import { useMemo } from "react";
import { asNumber, asString } from "@/lib/module-helpers";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type OperationsItem = {
  id: string;
  kind: "task" | "maintenance";
  title: string;
  emoji: string;
  status: string;
  statusLabel: string;
  priority: string;
  priorityLabel: string;
  propertyName: string | null;
  unitName: string | null;
  assigneeName: string | null;
  dueAt: string | null;
  createdAt: string;
  description: string | null;
  isOverdue: boolean;
  isUrgent: boolean;
  sortWeight: number;
  // Task-specific
  checklistTotal: number;
  checklistDone: number;
  // Maintenance-specific
  category: string | null;
  submittedBy: string | null;
  resolutionNotes: string | null;
  scheduledDate: string | null;
};

export type OperationsSummary = {
  openTaskCount: number;
  overdueTaskCount: number;
  maintenanceCount: number;
  emergencyCount: number;
  completionRate: number;
  slaCompliance: number;
};

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

type Params = {
  tasks: Record<string, unknown>[];
  requests: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
  members: Record<string, unknown>[];
  isEn: boolean;
};

const TASK_EMOJI: Record<string, string> = {
  cleaning: "\uD83E\uDDF9",
  maintenance: "\uD83D\uDD27",
  check_in: "\uD83D\uDCCB",
  check_out: "\uD83D\uDCE6",
  inspection: "\uD83D\uDD0D",
};
const DEFAULT_TASK_EMOJI = "\u2705";

const URGENCY_EMOJI: Record<string, string> = {
  emergency: "\uD83D\uDEA8",
  high: "\uD83D\uDD34",
  medium: "\uD83D\uDFE1",
  low: "\uD83D\uDFE2",
};

const TASK_CLOSED = new Set(["completed", "cancelled", "done"]);
const MAINT_CLOSED = new Set(["completed", "closed"]);

function taskStatusLabel(s: string, isEn: boolean): string {
  const n = s.toLowerCase();
  if (isEn) {
    if (n === "pending") return "Pending";
    if (n === "in_progress") return "In Progress";
    if (n === "completed") return "Completed";
    if (n === "cancelled") return "Cancelled";
    return n || "Unknown";
  }
  if (n === "pending") return "Pendiente";
  if (n === "in_progress") return "En progreso";
  if (n === "completed") return "Completado";
  if (n === "cancelled") return "Cancelado";
  return n || "Desconocido";
}

function maintStatusLabel(s: string, isEn: boolean): string {
  const n = s.toLowerCase();
  if (isEn) {
    if (n === "submitted") return "Submitted";
    if (n === "acknowledged") return "Acknowledged";
    if (n === "scheduled") return "Scheduled";
    if (n === "in_progress") return "In Progress";
    if (n === "completed") return "Completed";
    if (n === "closed") return "Closed";
    return n || "Unknown";
  }
  if (n === "submitted") return "Enviado";
  if (n === "acknowledged") return "Recibido";
  if (n === "scheduled") return "Programado";
  if (n === "in_progress") return "En progreso";
  if (n === "completed") return "Completado";
  if (n === "closed") return "Cerrado";
  return n || "Desconocido";
}

function urgencyLabel(u: string, isEn: boolean): string {
  const n = u.toLowerCase();
  if (isEn) {
    if (n === "emergency") return "Emergency";
    if (n === "high") return "High";
    if (n === "medium") return "Medium";
    if (n === "low") return "Low";
    return n || "Normal";
  }
  if (n === "emergency") return "Emergencia";
  if (n === "high") return "Alta";
  if (n === "medium") return "Media";
  if (n === "low") return "Baja";
  return n || "Normal";
}

function priorityLabel(p: string, isEn: boolean): string {
  const n = p.toLowerCase();
  if (isEn) {
    if (n === "urgent") return "Urgent";
    if (n === "high") return "High";
    if (n === "medium") return "Medium";
    if (n === "low") return "Low";
    return n || "Normal";
  }
  if (n === "urgent") return "Urgente";
  if (n === "high") return "Alta";
  if (n === "medium") return "Media";
  if (n === "low") return "Baja";
  return n || "Normal";
}

function computeSortWeight(
  _kind: "task" | "maintenance",
  status: string,
  priority: string,
  isOverdue: boolean
): number {
  const s = status.toLowerCase();
  const p = priority.toLowerCase();

  if (p === "emergency") return 1000;
  if (isOverdue) return 900;
  if (p === "urgent") return 800;
  if (p === "high") return 700;
  if (s === "in_progress") return 500;
  if (s === "submitted" || s === "pending" || s === "acknowledged") return 400;
  if (p === "medium") return 300;
  return 200;
}

function isDateOverdue(dateStr: string | null): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getTime() < Date.now();
}

export function useOperationsPortfolio({
  tasks,
  requests,
  properties,
  units,
  members,
  isEn,
}: Params): { items: OperationsItem[]; summary: OperationsSummary } {
  const propertyMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of properties) {
      const id = asString(p.id).trim();
      if (id) m.set(id, asString(p.name).trim() || id);
    }
    return m;
  }, [properties]);

  const unitMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of units) {
      const id = asString(u.id).trim();
      if (id)
        m.set(id, asString(u.name).trim() || asString(u.code).trim() || id);
    }
    return m;
  }, [units]);

  const memberMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const mb of members) {
      const userId = asString(mb.user_id).trim() || asString(mb.id).trim();
      const name =
        asString(mb.full_name).trim() ||
        asString(mb.name).trim() ||
        asString(mb.email).trim();
      if (userId && name) m.set(userId, name);
    }
    return m;
  }, [members]);

  const items = useMemo(() => {
    const result: OperationsItem[] = [];

    // Map tasks
    for (const t of tasks) {
      const status = asString(t.status).trim().toLowerCase();
      if (TASK_CLOSED.has(status)) continue;

      const taskType = asString(t.task_type).trim().toLowerCase();
      const prio = asString(t.priority).trim().toLowerCase() || "medium";
      const dueAt =
        asString(t.due_at).trim() || asString(t.due_date).trim() || null;
      const overdue = !TASK_CLOSED.has(status) && isDateOverdue(dueAt);
      const propertyId = asString(t.property_id).trim() || null;
      const unitId = asString(t.unit_id).trim() || null;
      const assigneeId = asString(t.assigned_user_id).trim() || null;
      const checklistTotal = asNumber(t.checklist_total);
      const checklistDone = asNumber(t.checklist_done);

      result.push({
        id: asString(t.id).trim(),
        kind: "task",
        title:
          asString(t.title).trim() ||
          asString(t.name).trim() ||
          (isEn ? "Untitled task" : "Tarea sin t\u00edtulo"),
        emoji: TASK_EMOJI[taskType] || DEFAULT_TASK_EMOJI,
        status,
        statusLabel: taskStatusLabel(status, isEn),
        priority: prio,
        priorityLabel: priorityLabel(prio, isEn),
        propertyName: propertyId ? (propertyMap.get(propertyId) ?? null) : null,
        unitName: unitId ? (unitMap.get(unitId) ?? null) : null,
        assigneeName: assigneeId ? (memberMap.get(assigneeId) ?? null) : null,
        dueAt,
        createdAt: asString(t.created_at).trim(),
        description: asString(t.description).trim() || null,
        isOverdue: overdue,
        isUrgent: prio === "urgent" || prio === "high",
        sortWeight: computeSortWeight("task", status, prio, overdue),
        checklistTotal,
        checklistDone,
        category: null,
        submittedBy: null,
        resolutionNotes: null,
        scheduledDate: null,
      });
    }

    // Map maintenance requests
    for (const r of requests) {
      const status = asString(r.status).trim().toLowerCase();
      if (MAINT_CLOSED.has(status)) continue;

      const urg = asString(r.urgency).trim().toLowerCase() || "medium";
      const createdAt = asString(r.created_at).trim();
      const propertyId = asString(r.property_id).trim() || null;
      const unitId = asString(r.unit_id).trim() || null;
      const scheduledDate = asString(r.scheduled_date).trim() || null;

      result.push({
        id: asString(r.id).trim(),
        kind: "maintenance",
        title:
          asString(r.title).trim() ||
          asString(r.description).trim().slice(0, 60) ||
          (isEn ? "Maintenance request" : "Solicitud de mantenimiento"),
        emoji: URGENCY_EMOJI[urg] || "\uD83D\uDFE1",
        status,
        statusLabel: maintStatusLabel(status, isEn),
        priority: urg,
        priorityLabel: urgencyLabel(urg, isEn),
        propertyName: propertyId ? (propertyMap.get(propertyId) ?? null) : null,
        unitName: unitId ? (unitMap.get(unitId) ?? null) : null,
        assigneeName: null,
        dueAt: scheduledDate,
        createdAt,
        description: asString(r.description).trim() || null,
        isOverdue: false,
        isUrgent: urg === "emergency" || urg === "high",
        sortWeight: computeSortWeight("maintenance", status, urg, false),
        checklistTotal: 0,
        checklistDone: 0,
        category: asString(r.category).trim() || null,
        submittedBy:
          asString(r.submitted_by_name).trim() ||
          asString(r.reported_by).trim() ||
          null,
        resolutionNotes: asString(r.resolution_notes).trim() || null,
        scheduledDate,
      });
    }

    // Sort by weight descending, then by createdAt descending
    result.sort((a, b) => {
      if (b.sortWeight !== a.sortWeight) return b.sortWeight - a.sortWeight;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return result;
  }, [tasks, requests, propertyMap, unitMap, memberMap, isEn]);

  const summary = useMemo<OperationsSummary>(() => {
    const taskItems = items.filter((i) => i.kind === "task");
    const maintItems = items.filter((i) => i.kind === "maintenance");
    const allTasks = tasks.length;
    const closedTasks = tasks.filter((t) =>
      TASK_CLOSED.has(asString(t.status).trim().toLowerCase())
    ).length;
    const allMaint = requests.length;
    const closedMaint = requests.filter((r) =>
      MAINT_CLOSED.has(asString(r.status).trim().toLowerCase())
    ).length;
    const totalItems = allTasks + allMaint;
    const totalClosed = closedTasks + closedMaint;
    const completionRate =
      totalItems > 0 ? Math.round((totalClosed / totalItems) * 100) : 100;

    // SLA compliance: % of maintenance that are NOT emergency/high open
    const openUrgent = maintItems.filter((i) => i.isUrgent).length;
    const slaCompliance =
      allMaint > 0
        ? Math.round(((allMaint - openUrgent) / allMaint) * 100)
        : 100;

    return {
      openTaskCount: taskItems.length,
      overdueTaskCount: taskItems.filter((i) => i.isOverdue).length,
      maintenanceCount: maintItems.length,
      emergencyCount: maintItems.filter((i) => i.priority === "emergency")
        .length,
      completionRate,
      slaCompliance,
    };
  }, [items, tasks, requests]);

  return { items, summary };
}
