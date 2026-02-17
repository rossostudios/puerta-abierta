"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { authedFetch } from "@/lib/api-client";

import { ActionConfigForm } from "./action-config-forms";

type Rule = Record<string, unknown>;

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

export const TRIGGER_EVENTS = [
  { value: "reservation_confirmed", en: "Reservation confirmed", es: "Reserva confirmada" },
  { value: "checked_in", en: "Checked in", es: "Check-in" },
  { value: "checked_out", en: "Checked out", es: "Check-out" },
  { value: "lease_created", en: "Lease created", es: "Contrato creado" },
  { value: "lease_activated", en: "Lease activated", es: "Contrato activado" },
  { value: "collection_overdue", en: "Collection overdue", es: "Cobro vencido" },
  { value: "application_received", en: "Application received", es: "Aplicación recibida" },
  { value: "maintenance_submitted", en: "Maintenance submitted", es: "Mantenimiento enviado" },
  { value: "task_completed", en: "Task completed", es: "Tarea completada" },
  { value: "payment_received", en: "Payment received", es: "Pago recibido" },
  { value: "lease_expiring", en: "Lease expiring", es: "Contrato por vencer" },
];

const ACTION_TYPES = [
  { value: "create_task", en: "Create task", es: "Crear tarea" },
  { value: "send_notification", en: "Send notification", es: "Enviar notificación" },
  { value: "send_whatsapp", en: "Send WhatsApp", es: "Enviar WhatsApp" },
  { value: "update_status", en: "Update status", es: "Actualizar estado" },
  { value: "create_expense", en: "Create expense", es: "Crear gasto" },
  { value: "assign_task_round_robin", en: "Assign task (round-robin)", es: "Asignar tarea (rotativa)" },
];

type WorkflowTemplate = {
  name_en: string;
  name_es: string;
  desc_en: string;
  desc_es: string;
  trigger_event: string;
  action_type: string;
  delay_minutes: number;
  action_config: Record<string, unknown>;
};

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    name_en: "Auto-create cleaning task on checkout",
    name_es: "Crear tarea de limpieza al checkout",
    desc_en: "Creates a high-priority cleaning task when a guest checks out.",
    desc_es: "Crea una tarea de limpieza prioritaria al hacer checkout.",
    trigger_event: "checked_out",
    action_type: "create_task",
    delay_minutes: 0,
    action_config: { title: "Turnover: limpieza post check-out", type: "cleaning", priority: "high" },
  },
  {
    name_en: "Send WhatsApp on check-in",
    name_es: "Enviar WhatsApp al check-in",
    desc_en: "Sends a welcome message via WhatsApp when a guest checks in.",
    desc_es: "Envía un mensaje de bienvenida por WhatsApp al hacer check-in.",
    trigger_event: "checked_in",
    action_type: "send_whatsapp",
    delay_minutes: 0,
    action_config: { body: "Welcome! We're happy to have you. Let us know if you need anything." },
  },
  {
    name_en: "Create expense on checkout",
    name_es: "Crear gasto al checkout",
    desc_en: "Automatically log a cleaning expense when a guest checks out.",
    desc_es: "Registra automáticamente un gasto de limpieza al checkout.",
    trigger_event: "checked_out",
    action_type: "create_expense",
    delay_minutes: 0,
    action_config: { category: "cleaning", description: "Turnover cleaning" },
  },
  {
    name_en: "Notify owner on maintenance request",
    name_es: "Notificar al propietario por mantenimiento",
    desc_en: "Sends a notification when a tenant submits a maintenance request.",
    desc_es: "Envía notificación al recibir una solicitud de mantenimiento.",
    trigger_event: "maintenance_submitted",
    action_type: "send_notification",
    delay_minutes: 0,
    action_config: { channel: "email", subject: "New maintenance request submitted" },
  },
  {
    name_en: "Send pre-arrival message 24h before",
    name_es: "Enviar mensaje pre-llegada 24h antes",
    desc_en: "Sends check-in instructions via WhatsApp 24h before confirmed reservation.",
    desc_es: "Envía instrucciones de check-in por WhatsApp 24h antes de la reserva confirmada.",
    trigger_event: "reservation_confirmed",
    action_type: "send_whatsapp",
    delay_minutes: 1440,
    action_config: { body: "Your stay starts tomorrow! Here are your check-in instructions..." },
  },
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

  // Form state
  const [formName, setFormName] = useState("");
  const [formTrigger, setFormTrigger] = useState("reservation_confirmed");
  const [formAction, setFormAction] = useState("create_task");
  const [formDelay, setFormDelay] = useState("0");
  const [formConfig, setFormConfig] = useState<Record<string, unknown>>({});
  const [rawJsonMode, setRawJsonMode] = useState(false);
  const [rawJson, setRawJson] = useState("{}");

  const triggerLabel = (value: string) => {
    const found = TRIGGER_EVENTS.find((t) => t.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  const actionLabel = (value: string) => {
    const found = ACTION_TYPES.find((a) => a.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  function resetForm() {
    setFormName("");
    setFormTrigger("reservation_confirmed");
    setFormAction("create_task");
    setFormDelay("0");
    setFormConfig({});
    setRawJsonMode(false);
    setRawJson("{}");
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      let config: Record<string, unknown>;
      if (rawJsonMode) {
        try {
          config = JSON.parse(rawJson);
        } catch {
          config = {};
        }
      } else {
        config = formConfig;
      }

      await authedFetch("/workflow-rules", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          name: formName,
          trigger_event: formTrigger,
          action_type: formAction,
          action_config: config,
          delay_minutes: Number(formDelay) || 0,
          is_active: true,
        }),
      });
      setShowForm(false);
      resetForm();
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(ruleId: string, currentlyActive: boolean) {
    try {
      await authedFetch(`/workflow-rules/${ruleId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentlyActive }),
      });
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  async function handleDelete(ruleId: string) {
    if (!confirm(isEn ? "Delete this rule?" : "¿Eliminar esta regla?")) return;
    try {
      await authedFetch(`/workflow-rules/${ruleId}`, { method: "DELETE" });
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  const [showTemplates, setShowTemplates] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  async function handleApplyTemplate(template: WorkflowTemplate) {
    setApplyingTemplate(template.name_en);
    try {
      await authedFetch("/workflow-rules", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          name: isEn ? template.name_en : template.name_es,
          trigger_event: template.trigger_event,
          action_type: template.action_type,
          action_config: template.action_config,
          delay_minutes: template.delay_minutes,
          is_active: true,
        }),
      });
      router.refresh();
      setShowTemplates(false);
    } catch {
      /* ignore */
    } finally {
      setApplyingTemplate(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            if (showForm) resetForm();
            setShowForm(!showForm);
          }}
          size="sm"
          type="button"
        >
          {showForm
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "New Rule"
              : "Nueva Regla"}
        </Button>
        <Button
          onClick={() => setShowTemplates(!showTemplates)}
          size="sm"
          type="button"
          variant="outline"
        >
          {showTemplates
            ? isEn ? "Hide Templates" : "Ocultar Plantillas"
            : isEn ? "Templates" : "Plantillas"}
        </Button>
      </div>

      {showTemplates && (
        <div className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_TEMPLATES.map((template) => (
            <div
              className="bg-muted/30 space-y-2 rounded-lg border p-3"
              key={template.name_en}
            >
              <p className="text-sm font-medium">
                {isEn ? template.name_en : template.name_es}
              </p>
              <p className="text-muted-foreground text-xs">
                {isEn ? template.desc_en : template.desc_es}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-muted rounded px-1.5 py-0.5">
                  {triggerLabel(template.trigger_event)}
                </span>
                <span>&rarr;</span>
                <span className="bg-muted rounded px-1.5 py-0.5">
                  {actionLabel(template.action_type)}
                </span>
                {template.delay_minutes > 0 && (
                  <span className="text-muted-foreground">
                    ({template.delay_minutes} min)
                  </span>
                )}
              </div>
              <Button
                disabled={applyingTemplate === template.name_en}
                onClick={() => handleApplyTemplate(template)}
                size="sm"
                variant="outline"
              >
                {applyingTemplate === template.name_en
                  ? isEn ? "Creating..." : "Creando..."
                  : isEn ? "Enable" : "Activar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form
          className="bg-muted/50 space-y-3 rounded-lg border p-4"
          onSubmit={handleSubmit}
        >
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Rule Name" : "Nombre de la regla"} *</span>
            <Input
              onChange={(e) => setFormName(e.target.value)}
              required
              value={formName}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "When" : "Cuando"}</span>
              <Select
                onChange={(e) => setFormTrigger(e.target.value)}
                value={formTrigger}
              >
                {TRIGGER_EVENTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {isEn ? t.en : t.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Then" : "Entonces"}</span>
              <Select
                onChange={(e) => {
                  setFormAction(e.target.value);
                  setFormConfig({});
                }}
                value={formAction}
              >
                {ACTION_TYPES.map((a) => (
                  <option key={a.value} value={a.value}>
                    {isEn ? a.en : a.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Delay (minutes)" : "Retraso (minutos)"}</span>
              <Input
                min="0"
                onChange={(e) => setFormDelay(e.target.value)}
                type="number"
                value={formDelay}
              />
            </label>
          </div>

          {/* Action config — structured forms or raw JSON */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {isEn ? "Action configuration" : "Configuración de la acción"}
              </span>
              <button
                className="text-muted-foreground text-xs underline"
                onClick={() => {
                  if (!rawJsonMode) {
                    setRawJson(JSON.stringify(formConfig, null, 2));
                  } else {
                    try {
                      setFormConfig(JSON.parse(rawJson));
                    } catch {
                      /* keep structured config unchanged */
                    }
                  }
                  setRawJsonMode(!rawJsonMode);
                }}
                type="button"
              >
                {rawJsonMode
                  ? isEn ? "Structured form" : "Formulario"
                  : isEn ? "Raw JSON" : "JSON directo"}
              </button>
            </div>

            {rawJsonMode ? (
              <textarea
                className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex min-h-[60px] w-full rounded-md border px-3 py-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                onChange={(e) => setRawJson(e.target.value)}
                rows={4}
                value={rawJson}
              />
            ) : (
              <ActionConfigForm
                actionType={formAction}
                isEn={isEn}
                onChange={setFormConfig}
                value={formConfig}
              />
            )}
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
                    {" \u2192 "}
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
