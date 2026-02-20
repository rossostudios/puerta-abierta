"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateMaintenanceRequestAction } from "@/app/(admin)/module/maintenance/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { DataTableRow } from "@/components/ui/data-table";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { NotionDataTable } from "@/components/ui/notion-data-table";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { useActiveLocale } from "@/lib/i18n/client";

type MaintenanceRow = {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  urgency: string | null;
  status: string;
  property_id: string | null;
  property_name: string | null;
  unit_id: string | null;
  unit_name: string | null;
  submitted_by_name: string | null;
  submitted_by_phone: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  resolution_notes: string | null;
  task_id: string | null;
  created_at: string | null;
  acknowledged_at: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
};

type MemberOption = { id: string; label: string };

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asOptionalString(value: unknown): string | null {
  const text = asString(value).trim();
  return text || null;
}

const STATUS_OPTIONS = [
  "new",
  "acknowledged",
  "scheduled",
  "in_progress",
  "completed",
  "closed",
] as const;

function statusTone(
  status: string
): "info" | "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "new":
      return "info";
    case "acknowledged":
    case "scheduled":
      return "warning";
    case "in_progress":
      return "warning";
    case "completed":
      return "success";
    case "closed":
      return "neutral";
    default:
      return "neutral";
  }
}

function urgencyTone(
  urgency: string | null
): "danger" | "warning" | "info" | "neutral" {
  switch (urgency) {
    case "emergency":
      return "danger";
    case "high":
      return "danger";
    case "medium":
      return "warning";
    case "low":
      return "info";
    default:
      return "neutral";
  }
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function MaintenanceManager({
  requests,
  properties,
  members,
}: {
  requests: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  members: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<MaintenanceRow | null>(null);

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [urgencyFilter, setUrgencyFilter] = useState("all");
  const [propertyFilter, setPropertyFilter] = useState("all");

  const memberOptions = useMemo<MemberOption[]>(() => {
    return (members as Record<string, unknown>[])
      .map((m) => {
        const id = asString(m.user_id).trim();
        const appUser = m.app_users as
          | Record<string, unknown>
          | null
          | undefined;
        const name =
          asString(m.full_name).trim() ||
          (appUser ? asString(appUser.full_name).trim() : "") ||
          asString(m.email).trim() ||
          (appUser ? asString(appUser.email).trim() : "") ||
          id;
        return id ? { id, label: name } : null;
      })
      .filter((item): item is MemberOption => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [members]);

  const propertyOptions = useMemo(() => {
    return (properties as Record<string, unknown>[])
      .map((p) => {
        const id = asString(p.id).trim();
        const name = asString(p.name).trim();
        return id ? { id, label: name || id } : null;
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [properties]);

  const rows = useMemo<MaintenanceRow[]>(() => {
    const needle = query.trim().toLowerCase();

    return (requests as Record<string, unknown>[])
      .map((row) => ({
        id: asString(row.id).trim(),
        title: asString(row.title).trim(),
        description: asOptionalString(row.description),
        category: asOptionalString(row.category),
        urgency: asOptionalString(row.urgency),
        status: asString(row.status).trim() || "new",
        property_id: asOptionalString(row.property_id),
        property_name: asOptionalString(row.property_name),
        unit_id: asOptionalString(row.unit_id),
        unit_name: asOptionalString(row.unit_name),
        submitted_by_name: asOptionalString(row.submitted_by_name),
        submitted_by_phone: asOptionalString(row.submitted_by_phone),
        assigned_user_id: asOptionalString(row.assigned_user_id),
        assigned_user_name: asOptionalString(row.assigned_user_name),
        resolution_notes: asOptionalString(row.resolution_notes),
        task_id: asOptionalString(row.task_id),
        created_at: asOptionalString(row.created_at),
        acknowledged_at: asOptionalString(row.acknowledged_at),
        scheduled_at: asOptionalString(row.scheduled_at),
        completed_at: asOptionalString(row.completed_at),
      }))
      .filter((row) => {
        if (!row.id) return false;

        if (statusFilter === "active") {
          if (row.status === "closed" || row.status === "completed")
            return false;
        } else if (statusFilter !== "all" && row.status !== statusFilter) {
          return false;
        }

        if (urgencyFilter !== "all" && row.urgency !== urgencyFilter)
          return false;

        if (propertyFilter !== "all" && row.property_id !== propertyFilter)
          return false;

        if (!needle) return true;

        const haystack = [
          row.title,
          row.description,
          row.category,
          row.submitted_by_name,
          row.property_name,
          row.unit_name,
          row.assigned_user_name,
        ]
          .filter(Boolean)
          .join(" | ")
          .toLowerCase();

        return haystack.includes(needle);
      });
  }, [requests, query, statusFilter, urgencyFilter, propertyFilter]);

  type OptimisticAction = { id: string; status: string };
  const [optimisticRows, queueOptimistic] = useOptimistic(
    rows,
    (current, action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, status: action.status } : r
      )
  );

  const [, startTransition] = useTransition();

  function handleQuickStatus(id: string, newStatus: string) {
    startTransition(async () => {
      queueOptimistic({ id, status: newStatus });
      const fd = new FormData();
      fd.set("request_id", id);
      fd.set("status", newStatus);
      fd.set("next", "/module/maintenance");
      try {
        await updateMaintenanceRequestAction(fd);
      } catch {
        let catchErrMsg: string;
        if (isEn) {
          catchErrMsg = "Status update failed";
        } else {
          catchErrMsg = "Error al actualizar estado";
        }
        toast.error(catchErrMsg);
      }
    });
  }

  const summaries = useMemo(() => {
    const total = rows.length;
    const newCount = rows.filter((r) => r.status === "new").length;
    const inProgress = rows.filter(
      (r) =>
        r.status === "acknowledged" ||
        r.status === "scheduled" ||
        r.status === "in_progress"
    ).length;
    const emergency = rows.filter((r) => r.urgency === "emergency").length;
    return { total, newCount, inProgress, emergency };
  }, [rows]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: isEn ? "Title" : "Título",
        cell: ({ getValue }) => (
          <span className="font-medium">{String(getValue())}</span>
        ),
      },
      {
        accessorKey: "status",
        header: isEn ? "Status" : "Estado",
        cell: ({ getValue }) => {
          const status = String(getValue());
          return <StatusBadge tone={statusTone(status)} value={status} />;
        },
      },
      {
        accessorKey: "urgency",
        header: isEn ? "Urgency" : "Urgencia",
        cell: ({ getValue }) => {
          const urgency = String(getValue() ?? "");
          if (!urgency) return <span className="text-muted-foreground">—</span>;
          return <StatusBadge tone={urgencyTone(urgency)} value={urgency} />;
        },
      },
      {
        accessorKey: "category",
        header: isEn ? "Category" : "Categoría",
        cell: ({ getValue }) => {
          const cat = String(getValue() ?? "");
          return cat ? (
            <Badge variant="outline">{cat}</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          );
        },
      },
      {
        accessorKey: "property_name",
        header: isEn ? "Property" : "Propiedad",
        cell: ({ getValue, row }) => {
          const prop = String(getValue() ?? "");
          const unit = String((row.original as MaintenanceRow).unit_name ?? "");
          if (!(prop || unit))
            return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-sm">
              {prop}
              {unit ? ` · ${unit}` : ""}
            </span>
          );
        },
      },
      {
        accessorKey: "submitted_by_name",
        header: isEn ? "Submitted by" : "Enviado por",
        cell: ({ getValue }) => {
          const name = String(getValue() ?? "");
          return name || <span className="text-muted-foreground">—</span>;
        },
      },
      {
        accessorKey: "assigned_user_name",
        header: isEn ? "Assigned" : "Asignado",
        cell: ({ getValue }) => {
          const name = String(getValue() ?? "");
          return name || <span className="text-muted-foreground">—</span>;
        },
      },
      {
        accessorKey: "created_at",
        header: isEn ? "Created" : "Creado",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground text-sm">
            {formatDate(String(getValue() ?? ""), locale)}
          </span>
        ),
      },
    ],
    [isEn, locale]
  );

  function openEdit(row: DataTableRow) {
    setEditing(row as unknown as MaintenanceRow);
    setEditOpen(true);
  }

  function renderRowActions(row: DataTableRow) {
    const data = row as unknown as MaintenanceRow;
    const nextStatus =
      data.status === "new"
        ? "acknowledged"
        : data.status === "acknowledged"
          ? "scheduled"
          : data.status === "scheduled"
            ? "in_progress"
            : data.status === "in_progress"
              ? "completed"
              : null;

    return (
      <div className="flex items-center gap-1">
        {nextStatus ? (
          <Button
            onClick={() => handleQuickStatus(data.id, nextStatus)}
            size="sm"
            variant="outline"
          >
            {nextStatus === "acknowledged"
              ? isEn
                ? "Acknowledge"
                : "Reconocer"
              : nextStatus === "scheduled"
                ? isEn
                  ? "Schedule"
                  : "Programar"
                : nextStatus === "in_progress"
                  ? isEn
                    ? "Start"
                    : "Iniciar"
                  : nextStatus === "completed"
                    ? isEn
                      ? "Complete"
                      : "Completar"
                    : nextStatus}
          </Button>
        ) : null}
        <Button onClick={() => openEdit(row)} size="sm" variant="ghost">
          {isEn ? "Edit" : "Editar"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Total requests" : "Total solicitudes"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {summaries.total}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "New" : "Nuevas"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {summaries.newCount}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "In progress" : "En progreso"}
          </p>
          <p className="font-semibold text-2xl tabular-nums">
            {summaries.inProgress}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Emergency" : "Emergencia"}
          </p>
          <p className="font-semibold text-2xl text-red-600 tabular-nums">
            {summaries.emergency}
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            className="w-56"
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isEn ? "Search..." : "Buscar..."}
            value={query}
          />
          <Select
            onChange={(e) => setStatusFilter(e.target.value)}
            value={statusFilter}
          >
            <option value="active">{isEn ? "Active" : "Activas"}</option>
            <option value="all">{isEn ? "All" : "Todas"}</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
          <Select
            onChange={(e) => setUrgencyFilter(e.target.value)}
            value={urgencyFilter}
          >
            <option value="all">
              {isEn ? "All urgencies" : "Todas las urgencias"}
            </option>
            <option value="emergency">
              {isEn ? "Emergency" : "Emergencia"}
            </option>
            <option value="high">{isEn ? "High" : "Alta"}</option>
            <option value="medium">{isEn ? "Medium" : "Media"}</option>
            <option value="low">{isEn ? "Low" : "Baja"}</option>
          </Select>
          <Select
            onChange={(e) => setPropertyFilter(e.target.value)}
            value={propertyFilter}
          >
            <option value="all">
              {isEn ? "All properties" : "Todas las propiedades"}
            </option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="text-muted-foreground text-sm">
          {optimisticRows.length} {isEn ? "requests" : "solicitudes"}
        </div>
      </div>

      <NotionDataTable
        columns={columns}
        data={optimisticRows}
        renderRowActions={renderRowActions}
        rowActionsHeader={isEn ? "Actions" : "Acciones"}
      />

      <Sheet
        contentClassName="max-w-xl"
        description={
          isEn
            ? "Update status, assignment, and resolution notes."
            : "Actualiza estado, asignación y notas de resolución."
        }
        onOpenChange={setEditOpen}
        open={editOpen}
        title={
          isEn
            ? `Edit: ${editing?.title ?? ""}`
            : `Editar: ${editing?.title ?? ""}`
        }
      >
        {editing ? (
          <Form action={updateMaintenanceRequestAction} className="space-y-4">
            <input name="request_id" type="hidden" value={editing.id} />
            <input name="next" type="hidden" value="/module/maintenance" />

            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                {isEn ? "Description" : "Descripción"}
              </p>
              <p>{editing.description || "—"}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">
                  {isEn ? "Property" : "Propiedad"}
                </p>
                <p>
                  {editing.property_name || "—"}
                  {editing.unit_name ? ` · ${editing.unit_name}` : ""}
                </p>
              </div>
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">
                  {isEn ? "Submitted by" : "Enviado por"}
                </p>
                <p>
                  {editing.submitted_by_name || "—"}
                  {editing.submitted_by_phone
                    ? ` (${editing.submitted_by_phone})`
                    : ""}
                </p>
              </div>
            </div>

            <label className="block space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">
                {isEn ? "Status" : "Estado"}
              </span>
              <Select defaultValue={editing.status} name="status">
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">
                {isEn ? "Assigned to" : "Asignado a"}
              </span>
              <Select
                defaultValue={editing.assigned_user_id ?? ""}
                name="assigned_user_id"
              >
                <option value="">{isEn ? "Unassigned" : "Sin asignar"}</option>
                {memberOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="block space-y-1 text-sm">
              <span className="font-medium text-muted-foreground">
                {isEn ? "Resolution notes" : "Notas de resolución"}
              </span>
              <Textarea
                defaultValue={editing.resolution_notes ?? ""}
                name="resolution_notes"
                rows={3}
              />
            </label>

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                onClick={() => setEditOpen(false)}
                type="button"
                variant="outline"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
              <Button type="submit" variant="secondary">
                {isEn ? "Save" : "Guardar"}
              </Button>
            </div>
          </Form>
        ) : null}
      </Sheet>
    </div>
  );
}
