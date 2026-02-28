"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { authedFetch } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/format";

type MlModel = {
  id: string;
  model_type: string;
  version: number;
  parameters: Record<string, unknown>;
  metrics: Record<string, unknown>;
  is_active: boolean;
  trained_at: string;
  created_at: string;
};

type MlOutcome = {
  id: string;
  predicted_value: number;
  actual_value: number;
  feedback_type: string;
  created_at: string;
};

type Props = {
  orgId: string;
  locale: string;
};

type CalibrationStatus = "healthy" | "needs_attention" | "inactive";

export function MarketCalibration({ orgId, locale }: Props) {
  const isEn = locale === "en-US";
  const [model, setModel] = useState<MlModel | null>(null);
  const [outcomes, setOutcomes] = useState<MlOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoCalibrate, setAutoCalibrate] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [modelsRes, outcomesRes] = await Promise.all([
        authedFetch<{ data: MlModel[] }>(
          `/ml-models?org_id=${encodeURIComponent(orgId)}&limit=5`
        ).catch(() => ({ data: [] as MlModel[] })),
        authedFetch<{ data: MlOutcome[] }>(
          `/ml-outcomes?org_id=${encodeURIComponent(orgId)}&limit=50`
        ).catch(() => ({ data: [] as MlOutcome[] })),
      ]);
      const models = Array.isArray(modelsRes.data) ? modelsRes.data : [];
      const active = models.find((m) => m.is_active) ?? null;
      setModel(active);
      setOutcomes(Array.isArray(outcomesRes.data) ? outcomesRes.data : []);
    } catch {
      // Endpoints may not exist yet — component handles gracefully
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rSquared =
    typeof model?.metrics?.r_squared === "number"
      ? (model.metrics.r_squared as number)
      : null;

  const status: CalibrationStatus = model
    ? rSquared !== null && rSquared > 0.5
      ? "healthy"
      : "needs_attention"
    : "inactive";

  const predictionAccuracy =
    outcomes.length > 0
      ? (() => {
          const errors = outcomes.map((o) =>
            o.actual_value !== 0
              ? Math.abs(o.predicted_value - o.actual_value) / o.actual_value
              : 0
          );
          const avgErrorRate =
            errors.reduce((a, b) => a + b, 0) / errors.length;
          return Math.round((1 - avgErrorRate) * 100);
        })()
      : null;

  const statusConfig = {
    healthy: {
      label: isEn ? "Healthy" : "Saludable",
      variant: "secondary" as const,
      className: "status-tone-success",
    },
    needs_attention: {
      label: isEn ? "Needs Attention" : "Necesita Atención",
      variant: "secondary" as const,
      className: "status-tone-warning",
    },
    inactive: {
      label: isEn ? "Inactive" : "Inactivo",
      variant: "outline" as const,
      className: "",
    },
  };

  const cfg = statusConfig[status];

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-16 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Status */}
        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-1.5 text-muted-foreground text-xs">
            {isEn ? "Calibration Status" : "Estado de Calibración"}
          </p>
          <Badge className={`text-xs ${cfg.className}`} variant={cfg.variant}>
            {cfg.label}
          </Badge>
        </div>

        {/* Last calibrated */}
        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-1.5 text-muted-foreground text-xs">
            {isEn ? "Last Calibrated" : "Última Calibración"}
          </p>
          <p className="font-medium text-sm">
            {model?.trained_at
              ? formatRelativeTime(model.trained_at, isEn)
              : isEn
                ? "Never"
                : "Nunca"}
          </p>
        </div>

        {/* Prediction accuracy */}
        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-1.5 text-muted-foreground text-xs">
            {isEn ? "Prediction Accuracy" : "Precisión de Predicción"}
          </p>
          <p className="font-semibold text-sm tabular-nums">
            {predictionAccuracy !== null ? `${predictionAccuracy}%` : "—"}
          </p>
        </div>

        {/* Auto-calibrate toggle */}
        <div className="rounded-lg border border-border/50 p-3">
          <p className="mb-1.5 text-muted-foreground text-xs">
            {isEn ? "Auto-Calibrate Weekly" : "Calibración Automática Semanal"}
          </p>
          <Switch checked={autoCalibrate} onCheckedChange={setAutoCalibrate} />
        </div>
      </div>

      {status === "inactive" && (
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Market calibration will activate automatically once enough reservation data is collected."
            : "La calibración de mercado se activará automáticamente cuando se recolecten suficientes datos de reservas."}
        </p>
      )}
    </div>
  );
}
