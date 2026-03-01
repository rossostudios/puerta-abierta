"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

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

export function MlModels({ orgId, locale }: Props) {
  const isEn = locale === "en-US";
  const [models, setModels] = useState<MlModel[]>([]);
  const [outcomes, setOutcomes] = useState<MlOutcome[]>([]);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [modelsRes, outcomesRes] = await Promise.all([
        fetch(
          `${API_BASE}/ml-models?org_id=${encodeURIComponent(orgId)}&limit=20`
        ).then((r) => (r.ok ? r.json() : { data: [] })),
        fetch(
          `${API_BASE}/ml-outcomes?org_id=${encodeURIComponent(orgId)}&limit=50`
        ).then((r) => (r.ok ? r.json() : { data: [] })),
      ]);
      setModels(Array.isArray(modelsRes.data) ? modelsRes.data : []);
      setOutcomes(Array.isArray(outcomesRes.data) ? outcomesRes.data : []);
    } catch {
      // Silently handle — tables may not exist yet
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRetrain = useCallback(async () => {
    setTraining(true);
    try {
      await fetch(`${API_BASE}/ml-models/retrain`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      // Refresh after short delay to allow training to complete
      setTimeout(() => {
        fetchData();
        setTraining(false);
      }, 2000);
    } catch {
      setTraining(false);
    }
  }, [orgId, fetchData]);

  const activeModel = models.find((m) => m.is_active);
  const elasticity = activeModel?.parameters?.elasticity;
  const rSquared = activeModel?.metrics?.r_squared;
  const dataMonths = activeModel?.metrics?.data_months;

  // Prediction accuracy from outcomes
  const predictionAccuracy =
    outcomes.length > 0
      ? (() => {
          const errors = outcomes.map((o) =>
            Math.abs(o.predicted_value - o.actual_value)
          );
          const avgError = errors.reduce((a, b) => a + b, 0) / errors.length;
          return avgError;
        })()
      : null;

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Active model card */}
      <div className="rounded-lg border border-border/50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="font-medium text-sm">
              {isEn ? "Price Elasticity Model" : "Modelo de Elasticidad de Precio"}
            </h4>
            <p className="mt-0.5 text-muted-foreground text-xs">
              {isEn
                ? "Learned from historical reservation data — replaces the default -0.8 hardcoded value."
                : "Aprendido de datos historicos de reservas — reemplaza el valor predeterminado de -0.8."}
            </p>
          </div>
          <Button
            className="h-7 text-xs"
            disabled={training}
            onClick={handleRetrain}
            size="sm"
            variant="outline"
          >
            {training
              ? isEn
                ? "Training..."
                : "Entrenando..."
              : isEn
                ? "Re-train Model"
                : "Re-entrenar Modelo"}
          </Button>
        </div>

        {activeModel ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <StatCard
              label={isEn ? "Elasticity" : "Elasticidad"}
              value={typeof elasticity === "number" ? elasticity.toFixed(3) : "-0.800"}
              badge={
                <Badge className="status-tone-success text-[10px]" variant="outline">
                  {isEn ? "Active" : "Activo"}
                </Badge>
              }
            />
            <StatCard
              label={isEn ? "R-squared" : "R-cuadrado"}
              value={typeof rSquared === "number" ? rSquared.toFixed(4) : "—"}
            />
            <StatCard
              label={isEn ? "Data Points" : "Puntos de Datos"}
              value={typeof dataMonths === "number" ? `${dataMonths} months` : "—"}
            />
            <StatCard
              label={isEn ? "Version" : "Version"}
              value={`v${activeModel.version}`}
              subtitle={formatDate(activeModel.trained_at)}
            />
          </div>
        ) : (
          <div className="mt-3 rounded-md bg-muted/50 p-3 text-center">
            <p className="text-muted-foreground text-sm">
              {isEn
                ? "No trained model yet. Click 'Re-train Model' to compute elasticity from your reservation history."
                : "Aun no hay modelo entrenado. Haga clic en 'Re-entrenar Modelo' para calcular la elasticidad de su historial de reservas."}
            </p>
          </div>
        )}
      </div>

      {/* Model history */}
      {models.length > 1 && (
        <div className="rounded-lg border border-border/50 p-4">
          <h4 className="mb-3 font-medium text-sm">
            {isEn ? "Model History" : "Historial de Modelos"}
          </h4>
          <div className="divide-y divide-border/40">
            {models.map((model) => (
              <div
                className="flex items-center justify-between py-2 text-sm"
                key={model.id}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">v{model.version}</span>
                  <span className="text-muted-foreground">
                    e={typeof model.parameters?.elasticity === "number"
                      ? (model.parameters.elasticity as number).toFixed(3)
                      : "?"}
                  </span>
                  {model.is_active && (
                    <Badge className="status-tone-success text-[10px]" variant="outline">
                      {isEn ? "Active" : "Activo"}
                    </Badge>
                  )}
                </div>
                <span className="text-muted-foreground text-xs">
                  {formatDate(model.trained_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prediction vs Actual */}
      {outcomes.length > 0 && (
        <div className="rounded-lg border border-border/50 p-4">
          <h4 className="mb-1 font-medium text-sm">
            {isEn ? "Prediction vs Actual" : "Prediccion vs Real"}
          </h4>
          <p className="mb-3 text-muted-foreground text-xs">
            {isEn
              ? `${outcomes.length} outcomes tracked. Average prediction error: ${predictionAccuracy !== null ? predictionAccuracy.toFixed(2) : "—"}`
              : `${outcomes.length} resultados rastreados. Error promedio de prediccion: ${predictionAccuracy !== null ? predictionAccuracy.toFixed(2) : "—"}`}
          </p>

          {/* Simple scatter visualization */}
          <div className="overflow-hidden rounded bg-muted/30 p-2">
            <svg
              className="h-32 w-full"
              preserveAspectRatio="xMidYMid meet"
              viewBox="0 0 400 120"
            >
              {/* Diagonal reference line (perfect prediction) */}
              <line
                stroke="currentColor"
                strokeDasharray="4 4"
                strokeOpacity={0.2}
                x1="10"
                x2="390"
                y1="110"
                y2="10"
              />
              {/* Outcome dots */}
              {outcomes.slice(0, 30).map((o, i) => {
                const maxVal = Math.max(
                  ...outcomes.map((oc) =>
                    Math.max(oc.predicted_value, oc.actual_value)
                  ),
                  1
                );
                const x = 10 + (o.predicted_value / maxVal) * 380;
                const y = 110 - (o.actual_value / maxVal) * 100;
                return (
                  <circle
                    cx={x}
                    cy={y}
                    fill="currentColor"
                    fillOpacity={0.5}
                    key={o.id || i}
                    r={3}
                  />
                );
              })}
              {/* Axis labels */}
              <text
                className="fill-muted-foreground text-[10px]"
                x="200"
                y="118"
              >
                {isEn ? "Predicted" : "Predicho"}
              </text>
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  badge,
}: {
  label: string;
  value: string;
  subtitle?: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border/30 p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground text-xs">{label}</span>
        {badge}
      </div>
      <p className="mt-1 font-mono font-semibold text-lg tabular-nums">{value}</p>
      {subtitle && (
        <p className="mt-0.5 text-muted-foreground text-[10px]">{subtitle}</p>
      )}
    </div>
  );
}
