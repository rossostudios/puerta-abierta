"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkflowRuleMetadataResponse } from "@/lib/api";
import { authedFetch } from "@/lib/api-client";

import { ActionConfigForm } from "./action-config-forms";

type Rule = Record<string, unknown>;
type RunRow = Record<string, unknown>;

type TriggerOption = {
  value: string;
  en: string;
  es: string;
};

type ActionOption = {
  value: string;
  en: string;
  es: string;
};

type ActionHint = {
  fields: string[];
  legacyAliases: Record<string, string>;
};

const FALLBACK_TRIGGERS: TriggerOption[] = [
  {
    value: "reservation_confirmed",
    en: "Reservation confirmed",
    es: "Reserva confirmada",
  },
  { value: "checked_in", en: "Checked in", es: "Check-in" },
  { value: "checked_out", en: "Checked out", es: "Check-out" },
  { value: "lease_created", en: "Lease created", es: "Contrato creado" },
  { value: "lease_activated", en: "Lease activated", es: "Contrato activado" },
  {
    value: "collection_overdue",
    en: "Collection overdue",
    es: "Cobro vencido",
  },
  {
    value: "application_received",
    en: "Application received",
    es: "Aplicacion recibida",
  },
  {
    value: "maintenance_submitted",
    en: "Maintenance submitted",
    es: "Mantenimiento enviado",
  },
  { value: "task_completed", en: "Task completed", es: "Tarea completada" },
  { value: "payment_received", en: "Payment received", es: "Pago recibido" },
  { value: "lease_expiring", en: "Lease expiring", es: "Contrato por vencer" },
];

const FALLBACK_ACTIONS: ActionOption[] = [
  { value: "create_task", en: "Create task", es: "Crear tarea" },
  {
    value: "assign_task_round_robin",
    en: "Assign task (round-robin)",
    es: "Asignar tarea (rotativa)",
  },
  {
    value: "send_notification",
    en: "Send notification",
    es: "Enviar notificacion",
  },
  { value: "send_whatsapp", en: "Send WhatsApp", es: "Enviar WhatsApp" },
  { value: "update_status", en: "Update status", es: "Actualizar estado" },
  { value: "create_expense", en: "Create expense", es: "Crear gasto" },
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
    action_config: {
      title: "Turnover: limpieza post check-out",
      type: "cleaning",
      priority: "high",
    },
  },
  {
    name_en: "Send WhatsApp on check-in",
    name_es: "Enviar WhatsApp al check-in",
    desc_en: "Sends a welcome message via WhatsApp when a guest checks in.",
    desc_es: "Envia un mensaje de bienvenida por WhatsApp al hacer check-in.",
    trigger_event: "checked_in",
    action_type: "send_whatsapp",
    delay_minutes: 0,
    action_config: {
      body: "Welcome! We're happy to have you. Let us know if you need anything.",
    },
  },
  {
    name_en: "Create expense on checkout",
    name_es: "Crear gasto al checkout",
    desc_en: "Automatically log a cleaning expense when a guest checks out.",
    desc_es: "Registra automaticamente un gasto de limpieza al checkout.",
    trigger_event: "checked_out",
    action_type: "create_expense",
    delay_minutes: 0,
    action_config: {
      category: "cleaning",
      description: "Turnover cleaning",
      amount: 150_000,
    },
  },
];

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

function asNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseActionHints(
  metadata?: WorkflowRuleMetadataResponse
): Record<string, ActionHint> {
  const raw = metadata?.config_schema_hints;
  if (!raw || typeof raw !== "object") return {};

  const hints: Record<string, ActionHint> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    const fieldsRaw = (value as Record<string, unknown>).fields;
    const aliasesRaw = (value as Record<string, unknown>).legacy_aliases;
    const fields = Array.isArray(fieldsRaw)
      ? fieldsRaw.filter((item): item is string => typeof item === "string")
      : [];

    const legacyAliases: Record<string, string> = {};
    if (aliasesRaw && typeof aliasesRaw === "object") {
      for (const [aliasKey, aliasTarget] of Object.entries(
        aliasesRaw as Record<string, unknown>
      )) {
        if (typeof aliasTarget === "string") {
          legacyAliases[aliasKey] = aliasTarget;
        }
      }
    }

    hints[key] = { fields, legacyAliases };
  }
  return hints;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function WorkflowRulesManager({
  data,
  locale,
  orgId,
  metadata,
}: {
  data: Rule[];
  locale: string;
  orgId: string;
  metadata?: WorkflowRuleMetadataResponse;
}) {
  const isEn = locale === "en-US";
  const router = useRouter();

  const triggerOptions = useMemo<TriggerOption[]>(() => {
    const server = Array.isArray(metadata?.triggers) ? metadata?.triggers : [];
    if (!server || server.length === 0) return FALLBACK_TRIGGERS;
    return server.map((item) => ({
      value: item.value,
      en: item.label_en || item.value,
      es: item.label_es || item.label_en || item.value,
    }));
  }, [metadata?.triggers]);

  const actionOptions = useMemo<ActionOption[]>(() => {
    const server = Array.isArray(metadata?.actions) ? metadata?.actions : [];
    if (!server || server.length === 0) return FALLBACK_ACTIONS;
    return server.map((item) => ({
      value: item.value,
      en: item.label_en || item.value,
      es: item.label_es || item.label_en || item.value,
    }));
  }, [metadata?.actions]);

  const actionHints = useMemo(() => parseActionHints(metadata), [metadata]);

  const defaultTrigger = triggerOptions[0]?.value ?? "reservation_confirmed";
  const defaultAction = actionOptions[0]?.value ?? "create_task";

  const [showForm, setShowForm] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formName, setFormName] = useState("");
  const [formTrigger, setFormTrigger] = useState(defaultTrigger);
  const [formAction, setFormAction] = useState(defaultAction);
  const [formDelay, setFormDelay] = useState("0");
  const [formConfig, setFormConfig] = useState<Record<string, unknown>>({});
  const [rawJsonMode, setRawJsonMode] = useState(false);
  const [rawJson, setRawJson] = useState("{}");

  const [showTemplates, setShowTemplates] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState<string | null>(null);

  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [runsByRule, setRunsByRule] = useState<Record<string, RunRow[]>>({});
  const [loadingRunsId, setLoadingRunsId] = useState<string | null>(null);

  const triggerLabel = (value: string) => {
    const found = triggerOptions.find((item) => item.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  const actionLabel = (value: string) => {
    const found = actionOptions.find((item) => item.value === value);
    return found ? (isEn ? found.en : found.es) : value;
  };

  const selectedHint = actionHints[formAction] ?? {
    fields: [],
    legacyAliases: {},
  };

  function resetForm() {
    setFormName("");
    setFormTrigger(defaultTrigger);
    setFormAction(defaultAction);
    setFormDelay("0");
    setFormConfig({});
    setRawJsonMode(false);
    setRawJson("{}");
    setEditingRuleId(null);
    setErrorMessage(null);
  }

  function openForCreate() {
    resetForm();
    setShowForm(true);
  }

  function openForEdit(rule: Rule) {
    const id = asString(rule.id);
    if (!id) return;

    const nextConfig =
      rule.action_config && typeof rule.action_config === "object"
        ? (rule.action_config as Record<string, unknown>)
        : {};

    setEditingRuleId(id);
    setFormName(asString(rule.name));
    setFormTrigger(asString(rule.trigger_event) || defaultTrigger);
    setFormAction(asString(rule.action_type) || defaultAction);
    setFormDelay(String(asNumber(rule.delay_minutes)));
    setFormConfig(nextConfig);
    setRawJson(JSON.stringify(nextConfig, null, 2));
    setRawJsonMode(false);
    setErrorMessage(null);
    setShowForm(true);
  }

  function validateConfig(config: Record<string, unknown>): string | null {
    if (!selectedHint.fields || selectedHint.fields.length === 0) return null;

    const allowed = new Set<string>([
      ...selectedHint.fields,
      ...Object.keys(selectedHint.legacyAliases),
    ]);
    const invalidKeys = Object.keys(config).filter((key) => !allowed.has(key));
    if (invalidKeys.length === 0) return null;

    return isEn
      ? `Invalid config keys for ${formAction}: ${invalidKeys.join(", ")}`
      : `Claves invalidas para ${formAction}: ${invalidKeys.join(", ")}`;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);

    let config: Record<string, unknown>;
    if (rawJsonMode) {
      try {
        config = JSON.parse(rawJson);
      } catch {
        const msg = isEn
          ? "Invalid JSON in action config."
          : "JSON invalido en la configuracion.";
        setErrorMessage(msg);
        toast.error(msg);
        setSubmitting(false);
        return;
      }
    } else {
      config = formConfig;
    }

    const validationError = validateConfig(config);
    if (validationError) {
      setErrorMessage(validationError);
      toast.error(validationError);
      setSubmitting(false);
      return;
    }

    const delayVal = Number(formDelay);
    const delayMinutes = Number.isFinite(delayVal) ? Math.max(0, delayVal) : 0;

    const payload = {
      organization_id: orgId,
      name: formName,
      trigger_event: formTrigger,
      action_type: formAction,
      action_config: config,
      delay_minutes: delayMinutes,
      is_active: true,
    };

    const successMessage = editingRuleId
      ? isEn
        ? "Rule updated"
        : "Regla actualizada"
      : isEn
        ? "Rule created"
        : "Regla creada";

    const request = editingRuleId
      ? authedFetch(`/workflow-rules/${editingRuleId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: payload.name,
            trigger_event: payload.trigger_event,
            action_type: payload.action_type,
            action_config: payload.action_config,
            delay_minutes: payload.delay_minutes,
          }),
        })
      : authedFetch("/workflow-rules", {
          method: "POST",
          body: JSON.stringify(payload),
        });

    try {
      await request;

      toast.success(successMessage);
      setShowForm(false);
      resetForm();
      router.refresh();
      setSubmitting(false);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setErrorMessage(message);
      toast.error(message);
      setSubmitting(false);
    }
  }

  async function toggleActive(ruleId: string, currentlyActive: boolean) {
    const successMessage = currentlyActive
      ? isEn
        ? "Rule disabled"
        : "Regla desactivada"
      : isEn
        ? "Rule activated"
        : "Regla activada";

    try {
      await authedFetch(`/workflow-rules/${ruleId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentlyActive }),
      });
      toast.success(successMessage);
      router.refresh();
    } catch (error) {
      toast.error(normalizeErrorMessage(error));
    }
  }

  async function deleteRule(ruleId: string) {
    const deletedMessage = isEn ? "Rule deleted" : "Regla eliminada";
    try {
      await authedFetch(`/workflow-rules/${ruleId}`, { method: "DELETE" });
      toast.success(deletedMessage);
      router.refresh();
    } catch (error) {
      toast.error(normalizeErrorMessage(error));
    }
  }

  function handleDelete(ruleId: string) {
    toast(isEn ? "Delete this rule?" : "Eliminar esta regla?", {
      action: {
        label: isEn ? "Delete" : "Eliminar",
        onClick: async () => {
          await deleteRule(ruleId);
        },
      },
    });
  }

  async function handleApplyTemplate(template: WorkflowTemplate) {
    setApplyingTemplate(template.name_en);
    setErrorMessage(null);
    const templateName = isEn ? template.name_en : template.name_es;
    const templateAppliedMessage = isEn
      ? "Template applied"
      : "Plantilla aplicada";

    try {
      await authedFetch("/workflow-rules", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          name: templateName,
          trigger_event: template.trigger_event,
          action_type: template.action_type,
          action_config: template.action_config,
          delay_minutes: template.delay_minutes,
          is_active: true,
        }),
      });
      toast.success(templateAppliedMessage);
      router.refresh();
      setShowTemplates(false);
      setApplyingTemplate(null);
    } catch (error) {
      const message = normalizeErrorMessage(error);
      setErrorMessage(message);
      toast.error(message);
      setApplyingTemplate(null);
    }
  }

  async function toggleRuns(ruleId: string) {
    const isOpen = expandedRuns[ruleId] === true;
    if (isOpen) {
      setExpandedRuns((prev) => ({ ...prev, [ruleId]: false }));
      return;
    }

    setExpandedRuns((prev) => ({ ...prev, [ruleId]: true }));
    if (runsByRule[ruleId]) return;

    setLoadingRunsId(ruleId);
    try {
      const response = await authedFetch<{ data?: RunRow[] }>(
        `/workflow-rules/${ruleId}/runs?limit=25`
      );
      setRunsByRule((prev) => ({ ...prev, [ruleId]: response.data ?? [] }));
      setLoadingRunsId(null);
    } catch (error) {
      toast.error(normalizeErrorMessage(error));
      setRunsByRule((prev) => ({ ...prev, [ruleId]: [] }));
      setLoadingRunsId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            if (showForm) {
              resetForm();
              setShowForm(false);
              return;
            }
            openForCreate();
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
            ? isEn
              ? "Hide Templates"
              : "Ocultar Plantillas"
            : isEn
              ? "Templates"
              : "Plantillas"}
        </Button>
      </div>

      {errorMessage ? (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm">
          {errorMessage}
        </p>
      ) : null}

      {showTemplates && (
        <div className="grid gap-3 sm:grid-cols-2">
          {WORKFLOW_TEMPLATES.map((template) => (
            <div
              className="space-y-2 rounded-lg border bg-muted/30 p-3"
              key={template.name_en}
            >
              <p className="font-medium text-sm">
                {isEn ? template.name_en : template.name_es}
              </p>
              <p className="text-muted-foreground text-xs">
                {isEn ? template.desc_en : template.desc_es}
              </p>
              <div className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted px-1.5 py-0.5">
                  {triggerLabel(template.trigger_event)}
                </span>
                <span>&rarr;</span>
                <span className="rounded bg-muted px-1.5 py-0.5">
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
                  ? isEn
                    ? "Creating..."
                    : "Creando..."
                  : isEn
                    ? "Enable"
                    : "Activar"}
              </Button>
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <form
          className="space-y-3 rounded-lg border bg-muted/50 p-4"
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
                {triggerOptions.map((trigger) => (
                  <option key={trigger.value} value={trigger.value}>
                    {isEn ? trigger.en : trigger.es}
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
                  setRawJson("{}");
                }}
                value={formAction}
              >
                {actionOptions.map((action) => (
                  <option key={action.value} value={action.value}>
                    {isEn ? action.en : action.es}
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                {isEn ? "Action configuration" : "Configuracion de la accion"}
              </span>
              <button
                className="text-muted-foreground text-xs underline"
                onClick={() => {
                  if (rawJsonMode) {
                    try {
                      setFormConfig(JSON.parse(rawJson));
                    } catch {
                      /* keep previous structured config */
                    }
                  } else {
                    setRawJson(JSON.stringify(formConfig, null, 2));
                  }
                  setRawJsonMode(!rawJsonMode);
                }}
                type="button"
              >
                {rawJsonMode
                  ? isEn
                    ? "Structured form"
                    : "Formulario"
                  : isEn
                    ? "Raw JSON"
                    : "JSON directo"}
              </button>
            </div>

            {selectedHint.fields.length > 0 ? (
              <p className="text-muted-foreground text-xs">
                {isEn ? "Allowed keys:" : "Claves permitidas:"}{" "}
                {selectedHint.fields.join(", ")}
              </p>
            ) : null}

            {rawJsonMode ? (
              <textarea
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              : editingRuleId
                ? isEn
                  ? "Update"
                  : "Actualizar"
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
            : "No hay reglas de automatizacion definidas."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {data.map((rule) => {
            const id = asString(rule.id);
            const isActive = rule.is_active === true;
            const isRunsOpen = expandedRuns[id] === true;
            const runs = runsByRule[id] ?? [];

            return (
              <div className="space-y-2 px-4 py-3" key={id}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{asString(rule.name)}</p>
                    <p className="text-muted-foreground text-xs">
                      {isEn ? "When" : "Cuando"}{" "}
                      <strong>
                        {triggerLabel(asString(rule.trigger_event))}
                      </strong>
                      {" \u2192 "}
                      <strong>{actionLabel(asString(rule.action_type))}</strong>
                      {Number(rule.delay_minutes) > 0 &&
                        ` (${isEn ? "after" : "despues de"} ${rule.delay_minutes} min)`}
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
                      onClick={() => openForEdit(rule)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {isEn ? "Edit" : "Editar"}
                    </Button>
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

                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => toggleRuns(id)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {isRunsOpen
                      ? isEn
                        ? "Hide runs"
                        : "Ocultar ejecuciones"
                      : isEn
                        ? "View runs"
                        : "Ver ejecuciones"}
                  </Button>
                </div>

                {isRunsOpen ? (
                  <div className="rounded-md border bg-muted/20 p-2 text-xs">
                    {loadingRunsId === id ? (
                      <p className="text-muted-foreground">
                        {isEn ? "Loading runs..." : "Cargando ejecuciones..."}
                      </p>
                    ) : runs.length === 0 ? (
                      <p className="text-muted-foreground">
                        {isEn
                          ? "No run history yet."
                          : "Sin historial todavia."}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {runs.map((run) => {
                          const runId = asString(run.id);
                          const status = asString(run.status) || "unknown";
                          const attempt = asString(run.attempt_number) || "-";
                          const createdAt = asString(run.created_at);
                          const reason = asString(run.reason);

                          return (
                            <div
                              className="rounded border bg-background px-2 py-1"
                              key={runId}
                            >
                              <p>
                                <strong>{status}</strong> · #{attempt}
                                {createdAt
                                  ? ` · ${new Date(createdAt).toLocaleString()}`
                                  : ""}
                              </p>
                              {reason ? (
                                <p className="text-muted-foreground">
                                  {reason}
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
