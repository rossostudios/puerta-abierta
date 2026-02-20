"use client";

import { Cancel01Icon, PlusSignIcon } from "@hugeicons/core-free-icons";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import { useActiveLocale } from "@/lib/i18n/client";

const SEQUENCE_TRIGGER_EVENTS = [
  {
    value: "reservation_confirmed",
    en: "Reservation confirmed",
    es: "Reserva confirmada",
  },
  { value: "checked_in", en: "Checked in", es: "Check-in" },
  { value: "checked_out", en: "Checked out", es: "Check-out" },
  { value: "lease_created", en: "Lease created", es: "Contrato creado" },
  {
    value: "lease_activated",
    en: "Lease activated",
    es: "Contrato activado",
  },
  { value: "lease_expiring", en: "Lease expiring", es: "Contrato por vencer" },
  { value: "manual", en: "Manual", es: "Manual" },
];

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

type Step = {
  id?: string;
  step_order: number;
  delay_hours: number;
  channel: string;
  subject: string;
  body_template: string;
  template_id: string;
};

function emptyStep(order: number): Step {
  return {
    step_order: order,
    delay_hours: 0,
    channel: "whatsapp",
    subject: "",
    body_template: "",
    template_id: "",
  };
}

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];

async function saveSequenceAndSteps(opts: {
  editingId: string | null;
  orgId: string;
  formName: string;
  formTrigger: string;
  formActive: boolean;
  steps: Step[];
  originalStepIds: string[];
  isEn: boolean;
}): Promise<string> {
  let sequenceId = opts.editingId;

  if (opts.editingId) {
    await authedFetch(`/communication-sequences/${opts.editingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: opts.formName,
        trigger_type: opts.formTrigger,
        is_active: opts.formActive,
      }),
    });
  } else {
    const created = await authedFetch<Record<string, unknown>>(
      "/communication-sequences",
      {
        method: "POST",
        body: JSON.stringify({
          organization_id: opts.orgId,
          name: opts.formName,
          trigger_type: opts.formTrigger,
          is_active: opts.formActive,
        }),
      }
    );
    sequenceId = asString(created.id);
  }

  if (!sequenceId) {
    const msg = opts.isEn
      ? "Failed to save sequence"
      : "Error al guardar secuencia";
    throw new Error(msg);
  }

  if (opts.editingId) {
    const currentStepIds = new Set(
      opts.steps
        .map((step) => (step.id ? step.id.trim() : ""))
        .filter((id) => id.length > 0)
    );
    const removedStepIds = opts.originalStepIds.filter(
      (id) => !currentStepIds.has(id)
    );

    for (const removedStepId of removedStepIds) {
      await authedFetch(`/sequence-steps/${removedStepId}`, {
        method: "DELETE",
      });
    }

    for (const step of opts.steps) {
      let templateIdVal: string | undefined;
      if (step.template_id) {
        templateIdVal = step.template_id;
      } else {
        templateIdVal = undefined;
      }
      let subjectVal: string | undefined;
      if (step.channel === "email") {
        subjectVal = step.subject;
      } else {
        subjectVal = undefined;
      }
      if (step.id) {
        await authedFetch(`/sequence-steps/${step.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            step_order: step.step_order,
            delay_hours: step.delay_hours,
            channel: step.channel,
            subject: subjectVal,
            body_template: step.body_template,
            template_id: templateIdVal,
          }),
        });
      } else {
        await authedFetch(`/communication-sequences/${sequenceId}/steps`, {
          method: "POST",
          body: JSON.stringify({
            step_order: step.step_order,
            delay_hours: step.delay_hours,
            channel: step.channel,
            subject: subjectVal,
            body_template: step.body_template,
            template_id: templateIdVal,
          }),
        });
      }
    }
  } else {
    for (const step of opts.steps) {
      if (!(step.body_template || step.template_id)) continue;
      let templateIdVal: string | undefined;
      if (step.template_id) {
        templateIdVal = step.template_id;
      } else {
        templateIdVal = undefined;
      }
      let subjectVal: string | undefined;
      if (step.channel === "email") {
        subjectVal = step.subject;
      } else {
        subjectVal = undefined;
      }
      await authedFetch(`/communication-sequences/${sequenceId}/steps`, {
        method: "POST",
        body: JSON.stringify({
          step_order: step.step_order,
          delay_hours: step.delay_hours,
          channel: step.channel,
          subject: subjectVal,
          body_template: step.body_template,
          template_id: templateIdVal,
        }),
      });
    }
  }

  if (opts.editingId) {
    return opts.isEn ? "Sequence updated" : "Secuencia actualizada";
  }
  return opts.isEn ? "Sequence created" : "Secuencia creada";
}

export function SequencesManager({
  sequences,
  templates,
  locale: _locale,
  orgId,
}: {
  sequences: Record<string, unknown>[];
  templates: Record<string, unknown>[];
  locale: string;
  orgId: string;
}) {
  "use no memo";
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingSteps, setLoadingSteps] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formTrigger, setFormTrigger] = useState("reservation_confirmed");
  const [formActive, setFormActive] = useState(true);
  const [steps, setSteps] = useState<Step[]>([emptyStep(1)]);
  const [originalStepIds, setOriginalStepIds] = useState<string[]>([]);

  const templateOptions = useMemo(
    () =>
      templates.map((t) => ({
        id: asString(t.id),
        name: asString(t.name),
      })),
    [templates]
  );

  const triggerLabel = useCallback(
    (value: string) => {
      const found = SEQUENCE_TRIGGER_EVENTS.find((t) => t.value === value);
      return found ? (isEn ? found.en : found.es) : value;
    },
    [isEn]
  );

  function resetForm() {
    setFormName("");
    setFormTrigger("reservation_confirmed");
    setFormActive(true);
    setSteps([emptyStep(1)]);
    setOriginalStepIds([]);
    setEditingId(null);
  }

  function openCreate() {
    resetForm();
    setSheetOpen(true);
  }

  async function openEdit(seq: Record<string, unknown>) {
    const id = asString(seq.id);
    setEditingId(id);
    setFormName(asString(seq.name));
    setFormTrigger(asString(seq.trigger_type) || "reservation_confirmed");
    setFormActive(seq.is_active !== false);
    setSheetOpen(true);

    // Load steps
    setLoadingSteps(true);
    try {
      const data = await authedFetch<{ data?: Record<string, unknown>[] }>(
        `/communication-sequences/${id}/steps?org_id=${encodeURIComponent(orgId)}`
      );
      let rawSteps: Record<string, unknown>[];
      if (data.data != null) {
        rawSteps = data.data;
      } else {
        rawSteps = [];
      }
      const loaded = rawSteps.map((s) => {
        const stepOrder = Number(s.step_order);
        const delayHours = Number(s.delay_hours);
        const channelVal = asString(s.channel);
        let stepOrderVal: number;
        if (Number.isFinite(stepOrder)) {
          if (stepOrder > 0) {
            stepOrderVal = stepOrder;
          } else {
            stepOrderVal = 1;
          }
        } else {
          stepOrderVal = 1;
        }
        let delayHoursVal: number;
        if (Number.isFinite(delayHours)) {
          delayHoursVal = delayHours;
        } else {
          delayHoursVal = 0;
        }
        let channelFinal: string;
        if (channelVal) {
          channelFinal = channelVal;
        } else {
          channelFinal = "whatsapp";
        }
        return {
          id: asString(s.id),
          step_order: stepOrderVal,
          delay_hours: delayHoursVal,
          channel: channelFinal,
          subject: asString(s.subject),
          body_template: asString(s.body_template),
          template_id: asString(s.template_id),
        };
      });
      let stepsToSet: Step[];
      if (loaded.length > 0) {
        stepsToSet = loaded;
      } else {
        stepsToSet = [emptyStep(1)];
      }
      setSteps(stepsToSet);
      setOriginalStepIds(
        loaded
          .map((step) => (step.id ? step.id.trim() : ""))
          .filter((id) => id.length > 0)
      );
      setLoadingSteps(false);
    } catch {
      setSteps([emptyStep(1)]);
      setOriginalStepIds([]);
      setLoadingSteps(false);
    }
  }

  function updateStep(index: number, partial: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...partial } : s))
    );
  }

  function addStep() {
    setSteps((prev) => [...prev, emptyStep(prev.length + 1)]);
  }

  function removeStep(index: number) {
    setSteps((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.map((s, i) => ({ ...s, step_order: i + 1 }));
    });
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    const errMsg = isEn
      ? "Failed to save sequence"
      : "Error al guardar secuencia";
    try {
      const successMsg = await saveSequenceAndSteps({
        editingId,
        orgId,
        formName,
        formTrigger,
        formActive,
        steps,
        originalStepIds,
        isEn,
      });
      toast.success(successMsg);
      setSheetOpen(false);
      resetForm();
      router.refresh();
    } catch {
      toast.error(errMsg);
    }
    setSubmitting(false);
  }

  async function deleteSequence(seqId: string) {
    try {
      await authedFetch(`/communication-sequences/${seqId}`, {
        method: "DELETE",
      });
      let delMsg: string;
      if (isEn) {
        delMsg = "Sequence deleted";
      } else {
        delMsg = "Secuencia eliminada";
      }
      toast.success(delMsg);
      router.refresh();
    } catch {
      let delErrMsg: string;
      if (isEn) {
        delErrMsg = "Delete failed";
      } else {
        delErrMsg = "Error al eliminar";
      }
      toast.error(delErrMsg);
    }
  }

  function handleDelete(seqId: string) {
    toast(isEn ? "Delete this sequence?" : "¿Eliminar esta secuencia?", {
      action: {
        label: isEn ? "Delete" : "Eliminar",
        onClick: async () => {
          await deleteSequence(seqId);
        },
      },
    });
  }

  async function toggleActive(seqId: string, currentlyActive: boolean) {
    try {
      await authedFetch(`/communication-sequences/${seqId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !currentlyActive }),
      });
      router.refresh();
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={openCreate} size="sm" type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New Sequence" : "Nueva Secuencia"}
        </Button>
      </div>

      {sequences.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {isEn ? "No sequences defined yet." : "No hay secuencias definidas."}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {sequences.map((seq) => {
            const id = asString(seq.id);
            const isActive = seq.is_active !== false;
            const stepsArr = Array.isArray(seq.steps) ? seq.steps : [];

            return (
              <div
                className="space-y-2 rounded-lg border p-4 transition-colors hover:bg-muted/20"
                key={id}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{asString(seq.name)}</p>
                    <p className="text-muted-foreground text-xs">
                      {triggerLabel(asString(seq.trigger_type))}
                      {" \u00b7 "}
                      {stepsArr.length} {isEn ? "steps" : "pasos"}
                    </p>
                  </div>
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
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => openEdit(seq)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isEn ? "Edit" : "Editar"}
                  </Button>
                  <Button
                    onClick={() => toggleActive(id, isActive)}
                    size="sm"
                    type="button"
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
                    type="button"
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

      {/* Create/Edit Sheet */}
      <Sheet
        contentClassName="max-w-xl"
        description={
          editingId
            ? isEn
              ? "Edit sequence and its steps."
              : "Edita la secuencia y sus pasos."
            : isEn
              ? "Create a multi-step automated messaging sequence."
              : "Crea una secuencia automatizada de mensajería."
        }
        onOpenChange={(open) => {
          if (!open) {
            setSheetOpen(false);
            resetForm();
          }
        }}
        open={sheetOpen}
        title={
          editingId
            ? isEn
              ? "Edit Sequence"
              : "Editar Secuencia"
            : isEn
              ? "New Sequence"
              : "Nueva Secuencia"
        }
      >
        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="space-y-1 text-sm">
            <span>{isEn ? "Name" : "Nombre"} *</span>
            <Input
              onChange={(e) => setFormName(e.target.value)}
              required
              value={formName}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span>{isEn ? "Trigger" : "Disparador"}</span>
              <Select
                onChange={(e) => setFormTrigger(e.target.value)}
                value={formTrigger}
              >
                {SEQUENCE_TRIGGER_EVENTS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {isEn ? t.en : t.es}
                  </option>
                ))}
              </Select>
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
                type="checkbox"
              />
              <span>{isEn ? "Active" : "Activo"}</span>
            </label>
          </div>

          {/* Steps editor */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">
                {isEn ? "Steps" : "Pasos"}
              </h3>
              <Button
                onClick={addStep}
                size="sm"
                type="button"
                variant="outline"
              >
                <Icon icon={PlusSignIcon} size={14} />
                {isEn ? "Add step" : "Agregar paso"}
              </Button>
            </div>

            {loadingSteps ? (
              <p className="text-muted-foreground text-xs">
                {isEn ? "Loading steps..." : "Cargando pasos..."}
              </p>
            ) : (
              <div className="space-y-3">
                {steps.map((step, idx) => (
                  <div
                    className="space-y-2 rounded-lg border bg-muted/30 p-3"
                    key={step.id ?? `step-${step.step_order}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-muted-foreground text-xs">
                        {isEn ? "Step" : "Paso"} {idx + 1}
                      </span>
                      {steps.length > 1 && (
                        <button
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => removeStep(idx)}
                          type="button"
                        >
                          <Icon icon={Cancel01Icon} size={14} />
                        </button>
                      )}
                    </div>

                    <div className="grid gap-2 sm:grid-cols-3">
                      <label className="space-y-1 text-xs">
                        <span>
                          {isEn ? "Delay (hours)" : "Retraso (horas)"}
                        </span>
                        <Input
                          min={0}
                          onChange={(e) =>
                            updateStep(idx, {
                              delay_hours: Number(e.target.value) || 0,
                            })
                          }
                          type="number"
                          value={step.delay_hours}
                        />
                      </label>
                      <label className="space-y-1 text-xs">
                        <span>{isEn ? "Channel" : "Canal"}</span>
                        <Select
                          onChange={(e) =>
                            updateStep(idx, { channel: e.target.value })
                          }
                          value={step.channel}
                        >
                          {CHANNELS.map((ch) => (
                            <option key={ch.value} value={ch.value}>
                              {ch.label}
                            </option>
                          ))}
                        </Select>
                      </label>
                      {templateOptions.length > 0 && (
                        <label className="space-y-1 text-xs">
                          <span>{isEn ? "Template" : "Plantilla"}</span>
                          <Select
                            onChange={(e) =>
                              updateStep(idx, { template_id: e.target.value })
                            }
                            value={step.template_id}
                          >
                            <option value="">
                              {isEn ? "None" : "Ninguna"}
                            </option>
                            {templateOptions.map((tpl) => (
                              <option key={tpl.id} value={tpl.id}>
                                {tpl.name}
                              </option>
                            ))}
                          </Select>
                        </label>
                      )}
                    </div>

                    {step.channel === "email" && (
                      <label className="space-y-1 text-xs">
                        <span>{isEn ? "Subject" : "Asunto"}</span>
                        <Input
                          onChange={(e) =>
                            updateStep(idx, { subject: e.target.value })
                          }
                          value={step.subject}
                        />
                      </label>
                    )}

                    <label className="space-y-1 text-xs">
                      <span>
                        {isEn ? "Message body" : "Cuerpo del mensaje"}
                      </span>
                      <Textarea
                        onChange={(e) =>
                          updateStep(idx, { body_template: e.target.value })
                        }
                        rows={2}
                        value={step.body_template}
                      />
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button disabled={submitting} type="submit">
              {submitting
                ? isEn
                  ? "Saving..."
                  : "Guardando..."
                : editingId
                  ? isEn
                    ? "Update"
                    : "Actualizar"
                  : isEn
                    ? "Create"
                    : "Crear"}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
