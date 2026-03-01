"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { authedFetch } from "@/lib/api-client";

type PricingRuleSet = {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  min_rate?: number | null;
  max_rate?: number | null;
  weekend_premium_pct: number;
  holiday_premium_pct: number;
  low_season_discount_pct: number;
  high_season_premium_pct: number;
  last_minute_days: number;
  last_minute_discount_pct: number;
  long_stay_threshold_days: number;
  long_stay_discount_pct: number;
  created_at: string;
  updated_at: string;
};

type Props = {
  orgId: string;
  initialRules: PricingRuleSet[];
  locale: string;
};

export function PricingRules({ orgId, initialRules, locale }: Props) {
  const isEn = locale === "en-US";
  const [rules, setRules] = useState(initialRules);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newRule, setNewRule] = useState({
    name: "",
    min_rate: 0,
    max_rate: 0,
    weekend_premium_pct: 10,
    holiday_premium_pct: 15,
    low_season_discount_pct: 5,
    high_season_premium_pct: 15,
    last_minute_days: 3,
    last_minute_discount_pct: 10,
    long_stay_threshold_days: 7,
    long_stay_discount_pct: 5,
  });

  const handleToggle = useCallback(
    async (id: string, isActive: boolean) => {
      try {
        await authedFetch(`/pricing-rule-sets/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ org_id: orgId, is_active: isActive }),
        });
        setRules((prev) =>
          prev.map((r) => (r.id === id ? { ...r, is_active: isActive } : r))
        );
      } catch {
        toast.error(isEn ? "Failed to update" : "Error al actualizar");
      }
    },
    [orgId, isEn]
  );

  const handleAdd = useCallback(async () => {
    if (!newRule.name.trim()) {
      toast.error(isEn ? "Name is required" : "El nombre es requerido");
      return;
    }
    setSaving(true);
    try {
      const res = await authedFetch<{ data: PricingRuleSet }>(
        "/pricing-rule-sets",
        {
          method: "POST",
          body: JSON.stringify({ org_id: orgId, ...newRule }),
        }
      );
      if (res.data) {
        setRules((prev) => [...prev, res.data]);
      }
      setAdding(false);
      toast.success(isEn ? "Rule set created" : "Conjunto de reglas creado");
    } catch {
      toast.error(isEn ? "Failed to create" : "Error al crear");
    } finally {
      setSaving(false);
    }
  }, [orgId, newRule, isEn]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await authedFetch(`/pricing-rule-sets/${id}`, {
          method: "DELETE",
          body: JSON.stringify({ org_id: orgId }),
        });
        setRules((prev) => prev.filter((r) => r.id !== id));
        toast.success(isEn ? "Rule deleted" : "Regla eliminada");
      } catch {
        toast.error(isEn ? "Failed to delete" : "Error al eliminar");
      }
    },
    [orgId, isEn]
  );

  const ruleRow = (label: string, value: string | number) => (
    <div className="flex items-center justify-between py-1">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium text-xs tabular-nums">{value}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {rules.length === 0 && !adding && (
        <p className="py-4 text-muted-foreground text-sm">
          {isEn
            ? "No pricing rules configured. Rules control min/max rates, weekend premiums, seasonal adjustments, and more."
            : "No hay reglas de precios configuradas. Las reglas controlan tarifas mín/máx, premiums de fin de semana, ajustes estacionales y más."}
        </p>
      )}

      <div className="space-y-2">
        {rules.map((rule) => (
          <div className="rounded-lg border border-border/50" key={rule.id}>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Switch
                  checked={rule.is_active}
                  onCheckedChange={(checked) => handleToggle(rule.id, checked)}
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{rule.name}</p>
                  {rule.description && (
                    <p className="truncate text-muted-foreground text-xs">
                      {rule.description}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {rule.is_active && (
                  <Badge className="text-[10px]" variant="secondary">
                    {isEn ? "Active" : "Activo"}
                  </Badge>
                )}
                <Button
                  onClick={() =>
                    setExpandedId(expandedId === rule.id ? null : rule.id)
                  }
                  size="sm"
                  variant="ghost"
                >
                  {expandedId === rule.id
                    ? isEn
                      ? "Collapse"
                      : "Colapsar"
                    : isEn
                      ? "Details"
                      : "Detalles"}
                </Button>
                <Button
                  onClick={() => handleDelete(rule.id)}
                  size="sm"
                  variant="ghost"
                >
                  {isEn ? "Delete" : "Eliminar"}
                </Button>
              </div>
            </div>

            {expandedId === rule.id && (
              <div className="border-border/50 border-t px-4 py-3">
                <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
                  {ruleRow(
                    isEn ? "Min Rate" : "Tarifa Mínima",
                    rule.min_rate ? `$${rule.min_rate}` : "—"
                  )}
                  {ruleRow(
                    isEn ? "Max Rate" : "Tarifa Máxima",
                    rule.max_rate ? `$${rule.max_rate}` : "—"
                  )}
                  {ruleRow(
                    isEn ? "Weekend Premium" : "Premium Fin de Semana",
                    `${rule.weekend_premium_pct}%`
                  )}
                  {ruleRow(
                    isEn ? "Holiday Premium" : "Premium Feriado",
                    `${rule.holiday_premium_pct}%`
                  )}
                  {ruleRow(
                    isEn ? "High Season Premium" : "Premium Temporada Alta",
                    `${rule.high_season_premium_pct}%`
                  )}
                  {ruleRow(
                    isEn ? "Low Season Discount" : "Descuento Temporada Baja",
                    `${rule.low_season_discount_pct}%`
                  )}
                  {ruleRow(
                    isEn ? "Last-Minute Days" : "Días Última Hora",
                    `${rule.last_minute_days}d`
                  )}
                  {ruleRow(
                    isEn ? "Last-Minute Discount" : "Descuento Última Hora",
                    `${rule.last_minute_discount_pct}%`
                  )}
                  {ruleRow(
                    isEn ? "Long Stay Threshold" : "Umbral Estadía Larga",
                    `${rule.long_stay_threshold_days}d`
                  )}
                  {ruleRow(
                    isEn ? "Long Stay Discount" : "Descuento Estadía Larga",
                    `${rule.long_stay_discount_pct}%`
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <div className="space-y-3 rounded-lg border border-border/50 bg-muted/10 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Rule Set Name" : "Nombre del Conjunto"}
              </label>
              <Input
                onChange={(e) =>
                  setNewRule((p) => ({ ...p, name: e.target.value }))
                }
                placeholder={
                  isEn
                    ? "e.g. Default Pricing Rules"
                    : "e.g. Reglas por Defecto"
                }
                value={newRule.name}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Min Rate ($)" : "Tarifa Mín ($)"}
              </label>
              <Input
                onChange={(e) =>
                  setNewRule((p) => ({
                    ...p,
                    min_rate: Number(e.target.value) || 0,
                  }))
                }
                type="number"
                value={newRule.min_rate}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Max Rate ($)" : "Tarifa Máx ($)"}
              </label>
              <Input
                onChange={(e) =>
                  setNewRule((p) => ({
                    ...p,
                    max_rate: Number(e.target.value) || 0,
                  }))
                }
                type="number"
                value={newRule.max_rate}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn ? "Weekend Premium (%)" : "Premium Fin de Semana (%)"}
              </label>
              <Input
                onChange={(e) =>
                  setNewRule((p) => ({
                    ...p,
                    weekend_premium_pct: Number(e.target.value) || 0,
                  }))
                }
                type="number"
                value={newRule.weekend_premium_pct}
              />
            </div>
            <div>
              <label className="mb-1 block font-medium text-xs">
                {isEn
                  ? "Last-Minute Discount (%)"
                  : "Descuento Última Hora (%)"}
              </label>
              <Input
                onChange={(e) =>
                  setNewRule((p) => ({
                    ...p,
                    last_minute_discount_pct: Number(e.target.value) || 0,
                  }))
                }
                type="number"
                value={newRule.last_minute_discount_pct}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button disabled={saving} onClick={handleAdd} size="sm">
              {saving
                ? isEn
                  ? "Saving..."
                  : "Guardando..."
                : isEn
                  ? "Create Rule Set"
                  : "Crear Conjunto de Reglas"}
            </Button>
            <Button onClick={() => setAdding(false)} size="sm" variant="ghost">
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
          </div>
        </div>
      )}

      {!adding && (
        <Button onClick={() => setAdding(true)} size="sm" variant="outline">
          {isEn ? "Add Pricing Rule Set" : "Agregar Conjunto de Reglas"}
        </Button>
      )}
    </div>
  );
}
