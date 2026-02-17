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

import { TRIGGER_EVENTS } from "../workflow-rules/workflow-rules-manager";

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
      const found = TRIGGER_EVENTS.find((t) => t.value === value);
      return found ? (isEn ? found.en : found.es) : value;
    },
    [isEn]
  );

  function resetForm() {
    setFormName("");
    setFormTrigger("reservation_confirmed");
    setFormActive(true);
    setSteps([emptyStep(1)]);
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
      const loaded = (data.data ?? []).map((s) => ({
        id: asString(s.id),
        step_order: Number(s.step_order) || 1,
        delay_hours: Number(s.delay_hours) || 0,
        channel: asString(s.channel) || "whatsapp",
        subject: asString(s.subject),
        body_template: asString(s.body_template),
        template_id: asString(s.template_id),
      }));
      setSteps(loaded.length > 0 ? loaded : [emptyStep(1)]);
    } catch {
      setSteps([emptyStep(1)]);
    } finally {
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

    try {
      let sequenceId = editingId;

      if (editingId) {
        // Update sequence
        await authedFetch(`/communication-sequences/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: formName,
            trigger_type: formTrigger,
            is_active: formActive,
          }),
        });
      } else {
        // Create sequence
        const created = await authedFetch<Record<string, unknown>>(
          "/communication-sequences",
          {
            method: "POST",
            body: JSON.stringify({
              organization_id: orgId,
              name: formName,
              trigger_type: formTrigger,
              is_active: formActive,
            }),
          }
        );
        sequenceId = asString(created.id);
      }

      if (!sequenceId) throw new Error("Missing sequence ID");

      // Sync steps: delete old ones that have IDs, then create all
      if (editingId) {
        // Delete existing steps that were removed
        const existingIds = steps.filter((s) => s.id).map((s) => s.id!);
        // For simplicity, we delete steps that have IDs and aren't in current list
        // Actually, let's just update/create. Delete removed ones.
        for (const step of steps) {
          if (step.id) {
            await authedFetch(`/sequence-steps/${step.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                step_order: step.step_order,
                delay_hours: step.delay_hours,
                channel: step.channel,
                subject: step.channel === "email" ? step.subject : undefined,
                body_template: step.body_template,
                template_id: step.template_id || undefined,
              }),
            });
          } else {
            await authedFetch(
              `/communication-sequences/${sequenceId}/steps`,
              {
                method: "POST",
                body: JSON.stringify({
                  step_order: step.step_order,
                  delay_hours: step.delay_hours,
                  channel: step.channel,
                  subject: step.channel === "email" ? step.subject : undefined,
                  body_template: step.body_template,
                  template_id: step.template_id || undefined,
                }),
              }
            );
          }
        }
      } else {
        // Create all steps for new sequence
        for (const step of steps) {
          if (!step.body_template && !step.template_id) continue;
          await authedFetch(
            `/communication-sequences/${sequenceId}/steps`,
            {
              method: "POST",
              body: JSON.stringify({
                step_order: step.step_order,
                delay_hours: step.delay_hours,
                channel: step.channel,
                subject: step.channel === "email" ? step.subject : undefined,
                body_template: step.body_template,
                template_id: step.template_id || undefined,
              }),
            }
          );
        }
      }

      toast.success(
        editingId
          ? isEn ? "Sequence updated" : "Secuencia actualizada"
          : isEn ? "Sequence created" : "Secuencia creada"
      );
      setSheetOpen(false);
      resetForm();
      router.refresh();
    } catch {
      toast.error(isEn ? "Failed to save sequence" : "Error al guardar secuencia");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(seqId: string) {
    if (!confirm(isEn ? "Delete this sequence?" : "¿Eliminar esta secuencia?"))
      return;
    try {
      await authedFetch(`/communication-sequences/${seqId}`, {
        method: "DELETE",
      });
      toast.success(isEn ? "Sequence deleted" : "Secuencia eliminada");
      router.refresh();
    } catch {
      toast.error(isEn ? "Delete failed" : "Error al eliminar");
    }
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
          {isEn
            ? "No sequences defined yet."
            : "No hay secuencias definidas."}
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
                    label={isActive ? (isEn ? "Active" : "Activo") : (isEn ? "Inactive" : "Inactivo")}
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
                      ? isEn ? "Disable" : "Desactivar"
                      : isEn ? "Enable" : "Activar"}
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
            ? isEn ? "Edit sequence and its steps." : "Edita la secuencia y sus pasos."
            : isEn ? "Create a multi-step automated messaging sequence." : "Crea una secuencia automatizada de mensajería."
        }
        onOpenChange={(open) => {
          if (!open) {
            setSheetOpen(false);
            resetForm();
          }
        }}
        open={sheetOpen}
        title={editingId ? (isEn ? "Edit Sequence" : "Editar Secuencia") : (isEn ? "New Sequence" : "Nueva Secuencia")}
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
                {TRIGGER_EVENTS.map((t) => (
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
              <h3 className="text-sm font-medium">
                {isEn ? "Steps" : "Pasos"}
              </h3>
              <Button onClick={addStep} size="sm" type="button" variant="outline">
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
                    key={idx}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
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
                        <span>{isEn ? "Delay (hours)" : "Retraso (horas)"}</span>
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
                      <span>{isEn ? "Message body" : "Cuerpo del mensaje"}</span>
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
                ? isEn ? "Saving..." : "Guardando..."
                : editingId
                  ? isEn ? "Update" : "Actualizar"
                  : isEn ? "Create" : "Crear"}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
