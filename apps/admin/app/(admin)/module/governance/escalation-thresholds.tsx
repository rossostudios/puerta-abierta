"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { authedFetch } from "@/lib/api-client";

type EscalationThreshold = {
  id: string;
  agent_slug?: string | null;
  threshold_type: string;
  threshold_value: number;
  action: string;
  notify_channel?: string | null;
  description?: string | null;
  is_active: boolean;
};

type Props = {
  orgId: string;
  initialThresholds?: EscalationThreshold[];
  locale: string;
};

const THRESHOLD_TYPES = [
  {
    value: "dollar_amount",
    labelEn: "Dollar Amount",
    labelEs: "Monto en Dólares",
  },
  {
    value: "action_count",
    labelEn: "Action Count",
    labelEs: "Cantidad de Acciones",
  },
  {
    value: "risk_score",
    labelEn: "Risk Score",
    labelEs: "Puntuación de Riesgo",
  },
  { value: "custom", labelEn: "Custom", labelEs: "Personalizado" },
];

const ACTIONS = [
  { value: "escalate", labelEn: "Escalate", labelEs: "Escalar" },
  { value: "block", labelEn: "Block", labelEs: "Bloquear" },
  { value: "notify", labelEn: "Notify", labelEs: "Notificar" },
  {
    value: "require_approval",
    labelEn: "Require Approval",
    labelEs: "Requiere Aprobación",
  },
];

export function EscalationThresholds({
  orgId,
  initialThresholds,
  locale,
}: Props) {
  const isEn = locale === "en-US";
  const [thresholds, setThresholds] = useState(initialThresholds ?? []);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newThreshold, setNewThreshold] = useState({
    threshold_type: "dollar_amount",
    threshold_value: 5000,
    action: "escalate",
    description: "",
    agent_slug: "",
  });

  // Fetch thresholds on mount when no initial data is provided
  useEffect(() => {
    if (initialThresholds && initialThresholds.length > 0) return;
    let cancelled = false;
    authedFetch<{ data?: EscalationThreshold[] }>(
      `/escalation-thresholds?org_id=${orgId}`
    )
      .then((res) => {
        if (!cancelled) setThresholds(res.data ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId, initialThresholds]);

  const handleToggle = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        await authedFetch(`/escalation-thresholds/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ org_id: orgId, is_active: isActive }),
        });
        setThresholds((prev) =>
          prev.map((t) => (t.id === id ? { ...t, is_active: isActive } : t))
        );
      } catch {
        toast.error(
          isEn ? "Failed to update threshold" : "Error al actualizar umbral"
        );
      }
    },
    [orgId, isEn]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await authedFetch(`/escalation-thresholds/${id}`, {
          method: "DELETE",
          body: JSON.stringify({ org_id: orgId }),
        });
        setThresholds((prev) => prev.filter((t) => t.id !== id));
        toast.success(isEn ? "Threshold deleted" : "Umbral eliminado");
      } catch {
        toast.error(
          isEn ? "Failed to delete threshold" : "Error al eliminar umbral"
        );
      }
    },
    [orgId, isEn]
  );

  const handleAdd = useCallback(async () => {
    setSaving(true);
    try {
      const res = await authedFetch<{ data: EscalationThreshold }>(
        "/escalation-thresholds",
        {
          method: "POST",
          body: JSON.stringify({
            org_id: orgId,
            ...newThreshold,
            agent_slug: newThreshold.agent_slug || null,
          }),
        }
      );
      if (res.data) {
        setThresholds((prev) => [...prev, res.data]);
      }
      setAdding(false);
      setNewThreshold({
        threshold_type: "dollar_amount",
        threshold_value: 5000,
        action: "escalate",
        description: "",
        agent_slug: "",
      });
      toast.success(isEn ? "Threshold created" : "Umbral creado");
    } catch {
      toast.error(
        isEn ? "Failed to create threshold" : "Error al crear umbral"
      );
    } finally {
      setSaving(false);
    }
  }, [orgId, newThreshold, isEn]);

  const typeLabel = (type: string) =>
    THRESHOLD_TYPES.find((t) => t.value === type)?.[
      isEn ? "labelEn" : "labelEs"
    ] ?? type;
  const actionLabel = (action: string) =>
    ACTIONS.find((a) => a.value === action)?.[isEn ? "labelEn" : "labelEs"] ??
    action;

  const actionTone = (action: string) => {
    if (action === "block") return "text-destructive";
    if (action === "escalate") return "text-amber-600";
    if (action === "require_approval") return "text-amber-500";
    return "text-muted-foreground";
  };

  return (
    <div className="space-y-4">
      {thresholds.length === 0 && !adding && (
        <p className="py-4 text-muted-foreground text-sm">
          {isEn
            ? "No escalation thresholds configured. Add one to control when agents must escalate to humans."
            : "No hay umbrales de escalamiento configurados. Agregue uno para controlar cuándo los agentes deben escalar a humanos."}
        </p>
      )}

      <div className="space-y-2">
        {thresholds.map((t) => (
          <div
            className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-4 py-3"
            key={t.id}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <Switch
                checked={t.is_active}
                onCheckedChange={(checked) => handleToggle(t.id, checked)}
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="text-[10px]" variant="secondary">
                    {typeLabel(t.threshold_type)}
                  </Badge>
                  <span className="font-medium text-sm tabular-nums">
                    {t.threshold_type === "dollar_amount"
                      ? `$${t.threshold_value.toLocaleString()}`
                      : t.threshold_value}
                  </span>
                  <span
                    className={`font-medium text-xs ${actionTone(t.action)}`}
                  >
                    → {actionLabel(t.action)}
                  </span>
                  {t.agent_slug && (
                    <Badge className="text-[10px]" variant="outline">
                      {t.agent_slug}
                    </Badge>
                  )}
                </div>
                {t.description && (
                  <p className="mt-0.5 truncate text-muted-foreground text-xs">
                    {t.description}
                  </p>
                )}
              </div>
            </div>
            <Button
              onClick={() => handleDelete(t.id)}
              size="sm"
              variant="ghost"
            >
              {isEn ? "Delete" : "Eliminar"}
            </Button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="space-y-3 rounded-lg border border-border/50 bg-muted/10 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Type" : "Tipo"}
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                onChange={(e) =>
                  setNewThreshold((p) => ({
                    ...p,
                    threshold_type: e.target.value,
                  }))
                }
                value={newThreshold.threshold_type}
              >
                {THRESHOLD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {isEn ? t.labelEn : t.labelEs}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Value" : "Valor"}
              </label>
              <Input
                onChange={(e) =>
                  setNewThreshold((p) => ({
                    ...p,
                    threshold_value: Number(e.target.value) || 0,
                  }))
                }
                type="number"
                value={newThreshold.threshold_value}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Action" : "Acción"}
              </label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                onChange={(e) =>
                  setNewThreshold((p) => ({ ...p, action: e.target.value }))
                }
                value={newThreshold.action}
              >
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {isEn ? a.labelEn : a.labelEs}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Agent (optional)" : "Agente (opcional)"}
              </label>
              <Input
                onChange={(e) =>
                  setNewThreshold((p) => ({
                    ...p,
                    agent_slug: e.target.value,
                  }))
                }
                placeholder="e.g. finance-agent"
                value={newThreshold.agent_slug}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block font-medium text-xs">
              {isEn ? "Description" : "Descripción"}
            </label>
            <Input
              onChange={(e) =>
                setNewThreshold((p) => ({
                  ...p,
                  description: e.target.value,
                }))
              }
              placeholder={
                isEn
                  ? "e.g. Block expenses over $5,000"
                  : "e.g. Bloquear gastos sobre $5,000"
              }
              value={newThreshold.description}
            />
          </div>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={handleAdd} size="sm">
              {saving
                ? isEn
                  ? "Saving..."
                  : "Guardando..."
                : isEn
                  ? "Save Threshold"
                  : "Guardar Umbral"}
            </Button>
            <Button onClick={() => setAdding(false)} size="sm" variant="ghost">
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
          </div>
        </div>
      )}

      {!adding && (
        <Button onClick={() => setAdding(true)} size="sm" variant="outline">
          {isEn ? "Add Escalation Threshold" : "Agregar Umbral de Escalamiento"}
        </Button>
      )}
    </div>
  );
}
