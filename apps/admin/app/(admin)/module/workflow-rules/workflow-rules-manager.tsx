"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type Rule = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

async function apiPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

async function apiPatch(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

async function apiDelete(path: string) {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw new Error("API error");
  return res.json();
}

const TRIGGER_EVENTS = [
  { value: "reservation_confirmed", en: "Reservation confirmed", es: "Reserva confirmada" },
  { value: "checked_in", en: "Checked in", es: "Check-in" },
  { value: "checked_out", en: "Checked out", es: "Check-out" },
  { value: "lease_created", en: "Lease created", es: "Contrato creado" },
  { value: "lease_activated", en: "Lease activated", es: "Contrato activado" },
  { value: "collection_overdue", en: "Collection overdue", es: "Cobro vencido" },
  { value: "application_received", en: "Application received", es: "Aplicación recibida" },
  { value: "maintenance_submitted", en: "Maintenance submitted", es: "Mantenimiento enviado" },
];

const ACTION_TYPES = [
  { value: "create_task", en: "Create task", es: "Crear tarea" },
  { value: "send_notification", en: "Send notification", es: "Enviar notificación" },
  { value: "update_status", en: "Update status", es: "Actualizar estado" },
  { value: "create_expense", en: "Create expense", es: "Crear gasto" },
];

export function WorkflowRulesManager({
  data,
  locale,
  orgId,
}: {
  data: Rule[];
  locale: string;
  orgId: string;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const triggerLabel = (value: string) => {
    const found = TRIGGER_EVENTS.find((t) => t.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  const actionLabel = (value: string) => {
    const found = ACTION_TYPES.find((a) => a.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/workflow-rules", {
        organization_id: orgId,
        name: fd.get("name"),
        trigger_event: fd.get("trigger_event"),
        action_type: fd.get("action_type"),
        action_config: {},
        delay_minutes: Number(fd.get("delay_minutes")) || 0,
        is_active: true,
      });
      setShowForm(false);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(ruleId: string, currentlyActive: boolean) {
    try {
      await apiPatch(`/workflow-rules/${ruleId}`, {
        is_active: !currentlyActive,
      });
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(ruleId: string) {
    if (!confirm(isEn ? "Delete this rule?" : "¿Eliminar esta regla?")) return;
    try {
      await apiDelete(`/workflow-rules/${ruleId}`);
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => setShowForm(!showForm)} size="sm" type="button">
          {showForm
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "New Rule"
              : "Nueva Regla"}
        </Button>
      </div>

      {showForm && (
        <form
          className="bg-muted/50 space-y-3 rounded-lg border p-4"
          onSubmit={handleSubmit}
        >
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Rule Name" : "Nombre de la regla"} *</span>
            <Input name="name" required />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "When" : "Cuando"}</span>
              <Select defaultValue="reservation_confirmed" name="trigger_event">
                {TRIGGER_EVENTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {isEn ? t.en : t.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Then" : "Entonces"}</span>
              <Select defaultValue="create_task" name="action_type">
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {isEn ? a.en : a.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Delay (minutes)" : "Retraso (minutos)"}</span>
              <Input defaultValue="0" min="0" name="delay_minutes" type="number" />
            </label>
          </div>
          <Button disabled={submitting} size="sm" type="submit">
            {submitting
              ? isEn
                ? "Saving..."
                : "Guardando..."
              : isEn
                ? "Save"
                : "Guardar"}
          </Button>
        </form>
      )}

      {data.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "No automation rules defined yet."
            : "No hay reglas de automatización definidas."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {data.map((rule) => {
            const id = asString(rule.id);
            const isActive = rule.is_active === true;
            return (
              <div
                className="flex items-center justify-between gap-3 px-4 py-3"
                key={id}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{asString(rule.name)}</p>
                  <p className="text-muted-foreground text-xs">
                    {isEn ? "When" : "Cuando"}{" "}
                    <strong>{triggerLabel(asString(rule.trigger_event))}</strong>
                    {" → "}
                    <strong>{actionLabel(asString(rule.action_type))}</strong>
                    {Number(rule.delay_minutes) > 0 &&
                      ` (${isEn ? "after" : "después de"} ${rule.delay_minutes} min)`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    label={
                      isActive
                        ? isEn
                          ? "Active"
                          : "Activo"
                        : isEn
                          ? "Inactive"
                          : "Inactivo"
                    }
                    value={isActive ? "active" : "inactive"}
                  />
                  <Button
                    onClick={() => toggleActive(id, isActive)}
                    size="sm"
                    variant="outline"
                  >
                    {isActive
                      ? isEn
                        ? "Disable"
                        : "Desactivar"
                      : isEn
                        ? "Enable"
                        : "Activar"}
                  </Button>
                  <Button
                    onClick={() => handleDelete(id)}
                    size="sm"
                    variant="ghost"
                  >
                    {isEn ? "Delete" : "Eliminar"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
