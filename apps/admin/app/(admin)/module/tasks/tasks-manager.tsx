"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { createTaskAction } from "@/app/(admin)/module/tasks/actions";
import { Button } from "@/components/ui/button";
import { type DataTableRow } from "@/components/ui/data-table";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { DatePicker } from "@/components/ui/date-picker";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  asNumber,
  asString,
  localizedPriorityLabel,
  localizedTaskStatusLabel,
  localizedTaskTypeLabel,
  priorityTone,
  shortId,
  PRIORITY_OPTIONS,
  TYPE_OPTIONS,
  type TaskRow,
  type UnitRow,
} from "@/lib/features/tasks/helpers";
import { useActiveLocale } from "@/lib/i18n/client";

import { TaskBoard } from "@/components/tasks/task-board";
import dynamic from "next/dynamic";

const TaskCharts = dynamic(() =>
  import("@/components/tasks/task-charts").then((m) => m.TaskCharts)
);
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskRowActions } from "@/components/tasks/task-row-actions";

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
                <Link
                  className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                  href={`/module/tasks/${encodeURIComponent(asString(row.original.id))}`}
                >
                  {title || (isEn ? "Task" : "Tarea")}
                </Link>
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

  return (
    <div className="space-y-4">
      <TaskFilters
        counts={counts}
        dueOn={dueOn}
        isEn={isEn}
        locale={locale}
        onDueOnChange={setDueOn}
        onNewTask={() => setOpen(true)}
        onQueryChange={setQuery}
        onStatusChange={setStatus}
        onTypeChange={setType}
        onUnitIdChange={setUnitId}
        query={query}
        status={status}
        type={type}
        unitId={unitId}
        unitOptions={unitOptions}
      />

      <TaskCharts
        counts={counts}
        isEn={isEn}
        locale={locale}
        rows={rows}
      />

      <TaskBoard
        isEn={isEn}
        locale={locale}
        onNewTask={() => setOpen(true)}
        rows={rows}
      />

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
                {TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {localizedTaskTypeLabel(isEn, opt)}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block space-y-1">
              <span className="block font-medium text-muted-foreground text-xs">
                {isEn ? "Priority" : "Prioridad"}
              </span>
              <Select defaultValue="medium" name="priority">
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {localizedPriorityLabel(isEn, opt)}
                  </option>
                ))}
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
