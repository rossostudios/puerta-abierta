"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authedFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

type Strategy = {
  id: string;
  name: string;
  description?: string | null;
  is_active: boolean;
  min_rate?: number | null;
  weekend_premium_pct?: number | null;
  holiday_premium_pct?: number | null;
  low_season_discount_pct?: number | null;
  high_season_premium_pct?: number | null;
  last_minute_days?: number | null;
  last_minute_discount_pct?: number | null;
  long_stay_threshold_days?: number | null;
  long_stay_discount_pct?: number | null;
};

type StrategyOption = {
  key: string;
  title_en: string;
  title_es: string;
  description_en: string;
  description_es: string;
  recommended?: boolean;
};

const STRATEGIES: StrategyOption[] = [
  {
    key: "aggressive_growth",
    title_en: "Aggressive Growth",
    title_es: "Crecimiento Agresivo",
    description_en:
      "Maximize revenue per booking. Higher premiums, minimal discounts. Best for high-demand properties.",
    description_es:
      "Maximizar ingresos por reserva. Premiums más altos, descuentos mínimos. Ideal para propiedades con alta demanda.",
  },
  {
    key: "maximum_occupancy",
    title_en: "Maximum Occupancy",
    title_es: "Máxima Ocupación",
    description_en:
      "Fill every unit. Generous discounts, moderate premiums. Best for new properties building reviews.",
    description_es:
      "Llenar cada unidad. Descuentos generosos, premiums moderados. Ideal para propiedades nuevas construyendo reseñas.",
  },
  {
    key: "balanced",
    title_en: "Balanced",
    title_es: "Equilibrado",
    description_en:
      "Optimize revenue and occupancy. Moderate adjustments. Recommended for most properties.",
    description_es:
      "Optimizar ingresos y ocupación. Ajustes moderados. Recomendado para la mayoría de las propiedades.",
    recommended: true,
  },
];

const PARAM_LABELS: Record<string, { en: string; es: string }> = {
  weekend_premium_pct: { en: "Weekend Premium", es: "Premium Fin de Semana" },
  holiday_premium_pct: { en: "Holiday Premium", es: "Premium Feriado" },
  high_season_premium_pct: {
    en: "High Season Premium",
    es: "Premium Temporada Alta",
  },
  low_season_discount_pct: {
    en: "Low Season Discount",
    es: "Descuento Temporada Baja",
  },
  last_minute_days: { en: "Last-Minute Window", es: "Ventana Última Hora" },
  last_minute_discount_pct: {
    en: "Last-Minute Discount",
    es: "Descuento Última Hora",
  },
  long_stay_threshold_days: {
    en: "Long Stay Threshold",
    es: "Umbral Estadía Larga",
  },
  long_stay_discount_pct: {
    en: "Long Stay Discount",
    es: "Descuento Estadía Larga",
  },
};

type Props = {
  orgId: string;
  initialStrategies: Strategy[];
  locale: string;
};

export function PricingStrategy({ orgId, initialStrategies, locale }: Props) {
  const isEn = locale === "en-US";
  const activeStrategy = initialStrategies.find((s) => s.is_active) ?? null;

  const [selected, setSelected] = useState<string>(
    activeStrategy?.name ?? "balanced"
  );
  const [minRate, setMinRate] = useState<number>(
    activeStrategy?.min_rate ? Math.round(activeStrategy.min_rate) : 0
  );
  const [saving, setSaving] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [savedStrategy, setSavedStrategy] = useState<Strategy | null>(
    activeStrategy
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      if (savedStrategy && savedStrategy.name === selected) {
        // Update existing
        const res = await authedFetch<{ data: Strategy }>(
          `/pricing/strategies/${savedStrategy.id}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              org_id: orgId,
              strategy: selected,
              min_rate: minRate || null,
              is_active: true,
            }),
          }
        );
        if (res.data) setSavedStrategy(res.data);
      } else {
        // Create new
        const res = await authedFetch<{ data: Strategy }>(
          "/pricing/strategies",
          {
            method: "POST",
            body: JSON.stringify({
              org_id: orgId,
              strategy: selected,
              min_rate: minRate || null,
            }),
          }
        );
        if (res.data) setSavedStrategy(res.data);
      }
      toast.success(
        isEn ? "Pricing strategy saved" : "Estrategia de precios guardada"
      );
    } catch {
      toast.error(
        isEn ? "Failed to save strategy" : "Error al guardar estrategia"
      );
    } finally {
      setSaving(false);
    }
  }, [orgId, selected, minRate, savedStrategy, isEn]);

  const hasChanges =
    selected !== (savedStrategy?.name ?? "") ||
    minRate !== Math.round(savedStrategy?.min_rate ?? 0);

  return (
    <div className="space-y-5">
      {/* Strategy cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        {STRATEGIES.map((s) => {
          const isSelected = selected === s.key;
          return (
            <button
              className={`rounded-lg border-2 p-4 text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border/50 hover:border-border"
              }`}
              key={s.key}
              onClick={() => setSelected(s.key)}
              type="button"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-sm">
                  {isEn ? s.title_en : s.title_es}
                </p>
                {s.recommended && (
                  <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-[10px] text-primary">
                    {isEn ? "Recommended" : "Recomendado"}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
                {isEn ? s.description_en : s.description_es}
              </p>
              {isSelected && (
                <div className="mt-2 h-0.5 w-8 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {/* Floor price input */}
      <div className="max-w-xs space-y-1.5">
        <label className="font-medium text-sm" htmlFor="strategy-min-rate">
          {isEn
            ? "Absolute Minimum Floor Price (PYG)"
            : "Precio Mínimo Absoluto (PYG)"}
        </label>
        <Input
          id="strategy-min-rate"
          min={0}
          onChange={(e) => setMinRate(Math.round(Number(e.target.value) || 0))}
          placeholder="0"
          step={1000}
          type="number"
          value={minRate || ""}
        />
        <p className="text-muted-foreground text-xs">
          {isEn
            ? "AI will never suggest rates below this amount."
            : "La IA nunca sugerirá tarifas por debajo de este monto."}
        </p>
      </div>

      {/* Save button */}
      <Button disabled={saving || !hasChanges} onClick={handleSave} size="sm">
        {saving
          ? isEn
            ? "Saving..."
            : "Guardando..."
          : isEn
            ? "Save Strategy"
            : "Guardar Estrategia"}
      </Button>

      {/* Collapsible AI parameters */}
      <div>
        <button
          className="text-muted-foreground text-xs underline-offset-2 hover:underline"
          onClick={() => setShowParams(!showParams)}
          type="button"
        >
          {showParams
            ? isEn
              ? "Hide AI parameters"
              : "Ocultar parámetros IA"
            : isEn
              ? "View AI parameters"
              : "Ver parámetros IA"}
        </button>

        {showParams && savedStrategy && (
          <div className="mt-3 grid gap-x-8 gap-y-1 rounded-lg border border-border/50 p-4 sm:grid-cols-2">
            {Object.entries(PARAM_LABELS).map(([key, labels]) => {
              const val = savedStrategy[key as keyof Strategy];
              const display =
                key.endsWith("_pct") && typeof val === "number"
                  ? `${val}%`
                  : key.endsWith("_days") && typeof val === "number"
                    ? `${val}d`
                    : val != null
                      ? String(val)
                      : "—";
              return (
                <div
                  className="flex items-center justify-between py-1"
                  key={key}
                >
                  <span className="text-muted-foreground text-xs">
                    {isEn ? labels.en : labels.es}
                  </span>
                  <span className="font-medium text-xs tabular-nums">
                    {display}
                  </span>
                </div>
              );
            })}
            {savedStrategy.min_rate != null && (
              <div className="flex items-center justify-between py-1">
                <span className="text-muted-foreground text-xs">
                  {isEn ? "Floor Price" : "Precio Mínimo"}
                </span>
                <span className="font-medium text-xs tabular-nums">
                  {formatCurrency(
                    Math.round(savedStrategy.min_rate),
                    "PYG",
                    locale
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
