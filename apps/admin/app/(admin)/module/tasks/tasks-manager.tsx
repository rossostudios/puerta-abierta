"use client";

import {
  Calendar02Icon,
  Message01Icon,
  PlusSignIcon,
  Ticket01Icon,
} from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import {
  completeTaskAction,
  createTaskAction,
  setTaskAssigneeAction,
  updateTaskStatusAction,
} from "@/app/(admin)/module/tasks/actions";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { type DataTableRow } from "@/components/ui/data-table";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { humanizeKey } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";

type UnitRow = {
  id: string;
  name?: string | null;
  code?: string | null;
  property_name?: string | null;
};

type TaskRow = {
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

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function shortId(value: string): string {
  const text = value.trim();
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function taskStatusActions(status: string): { kind: string; next?: string }[] {
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

function localizedTaskStatusLabel(isEn: boolean, status: string): string {
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

function localizedTaskActionLabel(
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

function localizedPriorityLabel(isEn: boolean, priority: string): string {
  const normalized = priority.trim().toLowerCase();
  if (isEn) return normalized || "normal";
  if (normalized === "low") return "Baja";
  if (normalized === "medium") return "Media";
  if (normalized === "high") return "Alta";
  if (normalized === "urgent") return "Urgente";
  return normalized || "normal";
}

function priorityTone(priority: string): StatusTone {
  const normalized = priority.trim().toLowerCase();
  if (normalized === "urgent") return "danger";
  if (normalized === "high") return "warning";
  if (normalized === "low") return "info";
  return "neutral";
}

function localizedTaskTypeLabel(isEn: boolean, value: string): string {
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

function formatDueLabel(
  locale: "es-PY" | "en-US",
  dueAt: string | null
): string {
  if (!dueAt) return "-";
  const date = new Date(dueAt);
  if (Number.isNaN(date.valueOf())) return dueAt;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(date);
}

const BOARD_LANES = [
  { key: "todo", status: "todo" },
  { key: "in_progress", status: "in_progress" },
  { key: "done", status: "done" },
];

function TaskLaneLabel(status: string, isEn: boolean): string {
  return localizedTaskStatusLabel(isEn, status);
}

function TaskRowActions({
  currentUserId,
  nextPath,
  row,
}: {
  currentUserId: string | null;
  nextPath: string;
  row: DataTableRow;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const id = asString(row.id).trim();
  const status = asString(row.status).trim();
  if (!(id && status)) return null;

  const assignedUserId = asString(row.assigned_user_id).trim();

  const actions = taskStatusActions(status);

  const assignmentControl =
    currentUserId && !assignedUserId ? (
      <Form action={setTaskAssigneeAction}>
        <input name="task_id" type="hidden" value={id} />
        <input name="assigned_user_id" type="hidden" value={currentUserId} />
        <input name="next" type="hidden" value={nextPath} />
        <Button size="sm" type="submit" variant="outline">
          {isEn ? "Take" : "Tomar"}
        </Button>
      </Form>
    ) : currentUserId && assignedUserId === currentUserId ? (
      <Form action={setTaskAssigneeAction}>
        <input name="task_id" type="hidden" value={id} />
        <input name="assigned_user_id" type="hidden" value="" />
        <input name="next" type="hidden" value={nextPath} />
        <Button size="sm" type="submit" variant="ghost">
          {isEn ? "Unassign" : "Soltar"}
        </Button>
      </Form>
    ) : null;

  if (!(actions.length || assignmentControl)) return null;

  return (
    <div className="flex flex-wrap justify-end gap-2">
      {assignmentControl}
      {actions.map((action) => {
        if (action.kind === "complete") {
          return (
            <Form action={completeTaskAction} key="complete">
              <input name="task_id" type="hidden" value={id} />
              <input name="next" type="hidden" value={nextPath} />
              <Button size="sm" type="submit" variant="secondary">
                {localizedTaskActionLabel(isEn, action.kind)}
              </Button>
            </Form>
          );
        }

        return (
          <Form action={updateTaskStatusAction} key={action.next}>
            <input name="task_id" type="hidden" value={id} />
            <input name="next" type="hidden" value={nextPath} />
            <input name="status" type="hidden" value={action.next ?? ""} />
            <Button size="sm" type="submit" variant="outline">
              {localizedTaskActionLabel(isEn, action.kind, action.next)}
            </Button>
          </Form>
        );
      })}
    </div>
  );
}

export function TasksManager({
  currentUserId,
  orgId,
  tasks,
  units,
}: {
  currentUserId: string | null;
  orgId: string;
  tasks: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const suffix = searchParams.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const [open, setOpen] = useState(false);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [unitId, setUnitId] = useState("all");

  const [dueOn, setDueOn] = useState("");

  const unitOptions = useMemo(() => {
    return (units as UnitRow[])
      .map((unit) => {
        const id = asString(unit.id).trim();
        if (!id) return null;
        const name = asString(unit.name).trim();
        const code = asString(unit.code).trim();
        const property = asString(unit.property_name).trim();
        const label = [property, code || name || id]
          .filter(Boolean)
          .join(" · ");
        return { id, label: label || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [units]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const normalizedStatus = status.trim().toLowerCase();
    const normalizedType = type.trim().toLowerCase();

    return (tasks as TaskRow[])
      .filter((task) => {
        const rowStatus = asString(task.status).trim().toLowerCase();
        if (normalizedStatus !== "all" && rowStatus !== normalizedStatus) {
          return false;
        }

        const rowType = asString(task.type).trim().toLowerCase();
        if (normalizedType !== "all" && rowType !== normalizedType) {
          return false;
        }

        const rowUnitId = asString(task.unit_id).trim();
        if (unitId !== "all" && rowUnitId !== unitId) {
          return false;
        }

        if (dueOn) {
          const dueAt = asString(task.due_at).trim();
          if (!dueAt.startsWith(dueOn)) {
            return false;
          }
        }

        if (!needle) return true;

        const haystack = [
          task.id,
          task.title,
          task.type,
          task.status,
          task.priority,
          task.unit_name,
          task.property_name,
          task.reservation_id,
        ]
          .map((value) => asString(value).trim().toLowerCase())
          .filter(Boolean)
          .join(" | ");

        return haystack.includes(needle);
      })
      .map((task) => {
        const id = asString(task.id).trim();
        const title = asString(task.title).trim();
        const statusValue = asString(task.status).trim();

        return {
          id,
          title,
          type: asString(task.type).trim() || null,
          status: statusValue || null,
          status_label: statusValue
            ? localizedTaskStatusLabel(isEn, statusValue)
            : null,
          priority: asString(task.priority).trim() || null,
          due_at: asString(task.due_at).trim() || null,
          sla_due_at: asString(task.sla_due_at).trim() || null,
          sla_breached_at: asString(task.sla_breached_at).trim() || null,
          completed_at: asString(task.completed_at).trim() || null,
          description: asString(task.description).trim() || null,
          automation_source: asString(task.automation_source).trim() || null,
          auto_generated: Boolean(task.auto_generated),
          assigned_user_id: asString(task.assigned_user_id).trim() || null,
          unit_id: asString(task.unit_id).trim() || null,
          unit_name: asString(task.unit_name).trim() || null,
          property_id: asString(task.property_id).trim() || null,
          property_name: asString(task.property_name).trim() || null,
          reservation_id: asString(task.reservation_id).trim() || null,
          checklist_total: asNumber(task.checklist_total),
          checklist_completed: asNumber(task.checklist_completed),
          checklist_required_total: asNumber(task.checklist_required_total),
          checklist_required_remaining: asNumber(
            task.checklist_required_remaining
          ),
        } satisfies DataTableRow;
      });
  }, [dueOn, isEn, query, status, tasks, type, unitId]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "title",
        header: isEn ? "Task" : "Tarea",
        cell: ({ row, getValue }) => {
          const title = asString(getValue()).trim();
          const typeValue = asString(row.original.type).trim();
          const priorityValue = asString(row.original.priority).trim();
          const autoGenerated = Boolean(row.original.auto_generated);
          const automationSource = asString(
            row.original.automation_source
          ).trim();
          const unit = asString(row.original.unit_name).trim();
          const property = asString(row.original.property_name).trim();
          const subtitle = [property, unit].filter(Boolean).join(" · ");

          return (
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 truncate font-medium">
                  {title || (isEn ? "Task" : "Tarea")}
                </span>
                {typeValue ? (
                  <StatusBadge
                    className="text-[11px]"
                    label={localizedTaskTypeLabel(isEn, typeValue)}
                    tone="info"
                    value={typeValue}
                  />
                ) : null}
                {priorityValue ? (
                  <StatusBadge
                    className="text-[11px]"
                    label={localizedPriorityLabel(isEn, priorityValue)}
                    tone={priorityTone(priorityValue)}
                    value={priorityValue}
                  />
                ) : null}
                {autoGenerated ? (
                  <StatusBadge
                    className="text-[11px]"
                    label={
                      automationSource === "reservation_create"
                        ? isEn
                          ? "Auto · create"
                          : "Auto · alta"
                        : isEn
                          ? "Auto · transition"
                          : "Auto · transición"
                    }
                    tone="info"
                    value={automationSource || "auto_generated"}
                  />
                ) : null}
              </div>
              {subtitle ? (
                <p className="truncate text-muted-foreground text-xs">
                  {subtitle}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "status",
        header: isEn ? "Status" : "Estado",
        cell: ({ row }) => {
          const raw = asString(row.original.status).trim();
          const label =
            asString(row.original.status_label).trim() || raw || "-";
          return <StatusBadge label={label} value={raw} />;
        },
      },
      {
        accessorKey: "due_at",
        header: isEn ? "Due" : "Vence",
        cell: ({ getValue }) => {
          const value = asString(getValue()).trim();
          if (!value) return <span className="text-muted-foreground">-</span>;
          const date = new Date(value);
          if (Number.isNaN(date.valueOf())) return value;
          return (
            <span className="whitespace-nowrap">
              {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                date
              )}
            </span>
          );
        },
      },
      {
        id: "checklist",
        header: isEn ? "Checklist" : "Checklist",
        accessorFn: (row) => row.checklist_total,
        enableSorting: false,
        cell: ({ row }) => {
          const total = asNumber(row.original.checklist_total);
          if (!total) return <span className="text-muted-foreground">-</span>;
          const completed = asNumber(row.original.checklist_completed);
          const remainingRequired = asNumber(
            row.original.checklist_required_remaining
          );

          const tone =
            remainingRequired > 0
              ? "warning"
              : completed >= total
                ? "success"
                : "neutral";

          return (
            <StatusBadge
              className="font-mono text-xs"
              label={`${completed}/${total}${remainingRequired > 0 ? ` · ${remainingRequired} ${isEn ? "req" : "req"}` : ""}`}
              tone={tone}
              value={remainingRequired > 0 ? "pending" : "done"}
            />
          );
        },
      },
      {
        accessorKey: "assigned_user_id",
        header: isEn ? "Assignee" : "Asignada",
        cell: ({ getValue }) => {
          const value = asString(getValue()).trim();
          if (!value) return <span className="text-muted-foreground">-</span>;
          if (currentUserId && value === currentUserId) {
            return (
              <StatusBadge
                className="text-[11px]"
                label={isEn ? "Me" : "Yo"}
                tone="info"
                value="assigned"
              />
            );
          }
          return (
            <span className="break-words font-mono text-xs">
              {shortId(value)}
            </span>
          );
        },
      },
    ];
  }, [currentUserId, isEn, locale]);

  const counts = useMemo(() => {
    const base = { todo: 0, in_progress: 0, done: 0, cancelled: 0 };
    for (const task of tasks as TaskRow[]) {
      const value = asString(task.status).trim().toLowerCase();
      if (value in base) {
        base[value as keyof typeof base] += 1;
      }
    }
    return base;
  }, [tasks]);

  const statusChartData = useMemo(
    () => [
      {
        key: "todo",
        label: isEn ? "To do" : "Pendiente",
        count: counts.todo,
      },
      {
        key: "in_progress",
        label: isEn ? "In progress" : "En progreso",
        count: counts.in_progress,
      },
      {
        key: "done",
        label: isEn ? "Done" : "Hecha",
        count: counts.done,
      },
      {
        key: "cancelled",
        label: isEn ? "Cancelled" : "Cancelada",
        count: counts.cancelled,
      },
    ],
    [counts, isEn]
  );

  const statusChartConfig: ChartConfig = useMemo(
    () => ({
      todo: { label: isEn ? "To do" : "Pendiente", color: "var(--chart-1)" },
      in_progress: {
        label: isEn ? "In progress" : "En progreso",
        color: "var(--chart-2)",
      },
      done: { label: isEn ? "Done" : "Hecha", color: "var(--chart-3)" },
      cancelled: {
        label: isEn ? "Cancelled" : "Cancelada",
        color: "var(--chart-4)",
      },
    }),
    [isEn]
  );

  const slaTrendData = useMemo(() => {
    const dayLabels: string[] = [];
    const today = new Date();
    for (let index = 6; index >= 0; index -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - index);
      dayLabels.push(date.toISOString().slice(0, 10));
    }

    const breachesByDay = new Map<string, number>(
      dayLabels.map((day) => [day, 0])
    );
    for (const row of rows) {
      const breachedAt = asString(row.sla_breached_at).trim();
      if (!breachedAt) continue;
      const day = breachedAt.slice(0, 10);
      if (!breachesByDay.has(day)) continue;
      breachesByDay.set(day, (breachesByDay.get(day) ?? 0) + 1);
    }

    return dayLabels.map((day) => {
      const parsed = new Date(`${day}T00:00:00`);
      return {
        day: Number.isNaN(parsed.valueOf())
          ? day
          : new Intl.DateTimeFormat(locale, {
              month: "short",
              day: "numeric",
            }).format(parsed),
        breaches: breachesByDay.get(day) ?? 0,
      };
    });
  }, [locale, rows]);

  const slaTrendConfig: ChartConfig = useMemo(
    () => ({
      breaches: {
        label: isEn ? "SLA breaches" : "SLA vencido",
        color: "var(--chart-5)",
      },
    }),
    [isEn]
  );

  const boardLanes = useMemo(() => {
    return BOARD_LANES.map((lane) => {
      const laneRows = rows
        .filter(
          (row) => asString(row.status).trim().toLowerCase() === lane.status
        )
        .sort((left, right) =>
          asString(right.due_at).localeCompare(asString(left.due_at))
        );
      return {
        ...lane,
        rows: laneRows,
      };
    });
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="grid w-full gap-2 md:grid-cols-4">
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Search" : "Buscar"}
            </span>
            <Input
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                isEn ? "Title, unit, status..." : "Título, unidad, estado..."
              }
              value={query}
            />
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Status" : "Estado"}
            </span>
            <Select
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="all">{isEn ? "All" : "Todos"}</option>
              <option value="todo">todo</option>
              <option value="in_progress">in_progress</option>
              <option value="done">done</option>
              <option value="cancelled">cancelled</option>
            </Select>
          </label>

          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Type" : "Tipo"}
            </span>
            <Select
              onChange={(event) => setType(event.target.value)}
              value={type}
            >
              <option value="all">{isEn ? "All" : "Todos"}</option>
              <option value="cleaning">cleaning</option>
              <option value="maintenance">maintenance</option>
              <option value="check_in">check_in</option>
              <option value="check_out">check_out</option>
              <option value="inspection">inspection</option>
              <option value="custom">custom</option>
            </Select>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Unit" : "Unidad"}
              </span>
              <Select
                onChange={(event) => setUnitId(event.target.value)}
                value={unitId}
              >
                <option value="all">{isEn ? "All" : "Todas"}</option>
                {unitOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Due" : "Vence"}
              </span>
              <DatePicker
                locale={locale}
                onValueChange={setDueOn}
                value={dueOn}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-2">
            <StatusBadge label={`todo ${counts.todo}`} value="todo" />
            <StatusBadge
              label={`in_progress ${counts.in_progress}`}
              value="in_progress"
            />
            <StatusBadge label={`done ${counts.done}`} value="done" />
            <StatusBadge
              label={`cancelled ${counts.cancelled}`}
              value="cancelled"
            />
          </div>

          <Button
            onClick={() => setOpen(true)}
            type="button"
            variant="secondary"
          >
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New task" : "Nueva tarea"}
          </Button>
        </div>
      </div>

      <section className="grid gap-3 xl:grid-cols-2">
        <article className="rounded-3xl border border-border/80 bg-card/85 p-3.5">
          <div className="mb-2">
            <p className="font-semibold text-sm">
              {isEn ? "Task distribution" : "Distribución de tareas"}
            </p>
            <p className="text-muted-foreground text-xs">
              {isEn ? "Status snapshot" : "Resumen por estado"}
            </p>
          </div>
          <ChartContainer className="h-48 w-full" config={statusChartConfig}>
            <BarChart data={statusChartData} margin={{ left: 2, right: 6 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="label"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={(props) => (
                  <ChartTooltipContent
                    {...props}
                    headerFormatter={() =>
                      isEn ? "Task status" : "Estado de tareas"
                    }
                  />
                )}
              />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {statusChartData.map((item) => (
                  <Cell fill={`var(--color-${item.key})`} key={item.key} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        </article>

        <article className="rounded-3xl border border-border/80 bg-card/85 p-3.5">
          <div className="mb-2">
            <p className="font-semibold text-sm">
              {isEn ? "SLA breaches trend" : "Tendencia de SLA vencido"}
            </p>
            <p className="text-muted-foreground text-xs">
              {isEn ? "Last 7 days" : "Últimos 7 días"}
            </p>
          </div>
          <ChartContainer className="h-48 w-full" config={slaTrendConfig}>
            <LineChart data={slaTrendData} margin={{ left: 2, right: 6 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="day"
                tickLine={false}
                tickMargin={8}
              />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} />
              <ChartTooltip
                content={(props) => (
                  <ChartTooltipContent
                    {...props}
                    headerFormatter={() =>
                      isEn ? "SLA breaches" : "SLA vencido"
                    }
                  />
                )}
              />
              <Line
                dataKey="breaches"
                dot={{ r: 3 }}
                stroke="var(--color-breaches)"
                strokeWidth={2}
                type="monotone"
              />
            </LineChart>
          </ChartContainer>
        </article>
      </section>

      <section className="grid gap-3 xl:grid-cols-3">
        {boardLanes.map((lane) => (
          <article
            className="rounded-3xl border border-border/80 bg-card/85 p-3"
            key={lane.key}
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="font-semibold text-lg">
                {TaskLaneLabel(lane.status, isEn)}
              </p>
              <StatusBadge
                label={String(lane.rows.length)}
                tone="neutral"
                value={lane.status}
              />
            </div>

            <div className="space-y-2">
              {lane.rows.length === 0 ? (
                <div className="rounded-2xl border border-border/80 border-dashed px-3 py-4 text-muted-foreground text-sm">
                  {isEn
                    ? "No tasks in this lane."
                    : "Sin tareas en esta columna."}
                </div>
              ) : (
                lane.rows.slice(0, 4).map((row) => {
                  const taskId = asString(row.id).trim();
                  const title = asString(row.title).trim();
                  const typeValue = asString(row.type).trim();
                  const priorityValue = asString(row.priority).trim();
                  const statusValue = asString(row.status).trim();
                  const statusLabel = asString(row.status_label).trim();
                  const description = asString(row.description).trim();
                  const autoGenerated = Boolean(row.auto_generated);
                  const automationSource = asString(
                    row.automation_source
                  ).trim();
                  const checklistTotal = asNumber(row.checklist_total);
                  const checklistCompleted = asNumber(row.checklist_completed);
                  const dueLabel = formatDueLabel(
                    locale,
                    asString(row.due_at).trim() || null
                  );
                  const reservationId = asString(row.reservation_id).trim();
                  const assignee = asString(row.assigned_user_id).trim();

                  return (
                    <div
                      className="rounded-2xl border border-border/70 bg-background/80 p-3"
                      key={taskId}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        {priorityValue ? (
                          <StatusBadge
                            className="text-[11px]"
                            label={localizedPriorityLabel(isEn, priorityValue)}
                            tone={priorityTone(priorityValue)}
                            value={priorityValue}
                          />
                        ) : null}
                        <StatusBadge
                          className="text-[11px]"
                          label={statusLabel}
                          value={statusValue}
                        />
                        {typeValue ? (
                          <StatusBadge
                            className="text-[11px]"
                            label={localizedTaskTypeLabel(isEn, typeValue)}
                            tone="info"
                            value={typeValue}
                          />
                        ) : null}
                        {autoGenerated ? (
                          <StatusBadge
                            className="text-[11px]"
                            label={
                              automationSource === "reservation_create"
                                ? isEn
                                  ? "Auto · create"
                                  : "Auto · alta"
                                : isEn
                                  ? "Auto · transition"
                                  : "Auto · transición"
                            }
                            tone="info"
                            value={automationSource || "auto_generated"}
                          />
                        ) : null}
                      </div>

                      <p className="line-clamp-2 font-semibold text-xl leading-tight">
                        {title || (isEn ? "Task" : "Tarea")}
                      </p>

                      {description ? (
                        <p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
                          {description}
                        </p>
                      ) : null}

                      <div className="mt-3 flex items-center justify-between border-border/70 border-t pt-2">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/80 bg-muted/30 font-medium text-[11px] uppercase">
                            {(assignee || "?").slice(0, 1)}
                          </span>
                          {reservationId ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                              <Icon icon={Ticket01Icon} size={13} />
                              {shortId(reservationId)}
                            </span>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3 text-muted-foreground text-xs">
                          {checklistTotal > 0 ? (
                            <span className="inline-flex items-center gap-1">
                              <Icon icon={Message01Icon} size={13} />
                              {checklistCompleted}/{checklistTotal}
                            </span>
                          ) : null}
                          <span className="inline-flex items-center gap-1">
                            <Icon icon={Calendar02Icon} size={13} />
                            {dueLabel}
                          </span>
                          <Link
                            className="font-medium text-foreground underline-offset-4 hover:underline"
                            href={`/module/tasks/${encodeURIComponent(taskId)}`}
                          >
                            {isEn ? "Open" : "Abrir"}
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}

              <button
                className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-border/70 text-sm transition-colors hover:bg-muted/40"
                onClick={() => setOpen(true)}
                type="button"
              >
                <Icon icon={PlusSignIcon} size={15} />
                {isEn ? "Add Task" : "Agregar tarea"}
              </button>
            </div>
          </article>
        ))}
      </section>

      <NotionDataTable
        columns={columns}
        data={rows}
        hideSearch
        isEn={isEn}
        renderRowActions={(row) => (
          <TaskRowActions
            currentUserId={currentUserId}
            nextPath={nextPath}
            row={row}
          />
        )}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
      />

      <Sheet
        description={
          isEn
            ? "Create a task for cleaning, maintenance, or follow-up work."
            : "Crea una tarea de limpieza, mantenimiento o seguimiento."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New task" : "Nueva tarea"}
      >
        <Form action={createTaskAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Title" : "Título"}
            </span>
            <Input
              name="title"
              placeholder={isEn ? "e.g. Cleaning" : "Ej. Limpieza"}
              required
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Type" : "Tipo"}
              </span>
              <Select defaultValue="custom" name="type">
                <option value="cleaning">cleaning</option>
                <option value="maintenance">maintenance</option>
                <option value="check_in">check_in</option>
                <option value="check_out">check_out</option>
                <option value="inspection">inspection</option>
                <option value="custom">custom</option>
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Priority" : "Prioridad"}
              </span>
              <Select defaultValue="medium" name="priority">
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="urgent">urgent</option>
              </Select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Unit (optional)" : "Unidad (opcional)"}
            </span>
            <Select defaultValue="" name="unit_id">
              <option value="">{isEn ? "No unit" : "Sin unidad"}</option>
              {unitOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </Select>
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn
                  ? "Reservation ID (optional)"
                  : "ID de reserva (opcional)"}
              </span>
              <Input
                name="reservation_id"
                placeholder={isEn ? "Paste UUID" : "Pega el UUID"}
              />
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Due date (optional)" : "Vence (opcional)"}
              </span>
              <DatePicker locale={locale} name="due_on" />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "Description (optional)" : "Descripción (opcional)"}
            </span>
            <Input
              name="description"
              placeholder={isEn ? "Optional" : "Opcional"}
            />
          </label>

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button type="submit" variant="secondary">
              {isEn ? "Create" : "Crear"}
            </Button>
          </div>
        </Form>
      </Sheet>
    </div>
  );
}
