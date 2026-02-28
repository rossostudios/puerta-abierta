"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { authedFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";

type Recommendation = {
  id: string;
  unit_id?: string | null;
  recommendation_type: string;
  current_rate?: number | null;
  recommended_rate?: number | null;
  confidence: number;
  reasoning: string;
  revenue_impact_estimate?: number | null;
  date_range_start?: string | null;
  date_range_end?: string | null;
  status: string;
  agent_slug: string;
  created_at: string;
};

type Props = {
  orgId: string;
  initialRecommendations: unknown[];
  locale: string;
};

export function PricingHero({ orgId, initialRecommendations, locale }: Props) {
  const isEn = locale === "en-US";
  const [recommendations, setRecommendations] = useState<Recommendation[]>(
    (initialRecommendations as Recommendation[]) ?? []
  );
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [updating, setUpdating] = useState<string | null>(null);

  const refresh = useCallback(
    async (status = statusFilter) => {
      try {
        const res = await authedFetch<{ data: Recommendation[] }>(
          `/pricing/recommendations?org_id=${orgId}&status=${status}&limit=50`
        );
        setRecommendations(res.data ?? []);
      } catch {
        // keep existing data
      }
    },
    [orgId, statusFilter]
  );

  const handleAction = useCallback(
    async (id: string, action: "approved" | "dismissed") => {
      setUpdating(id);
      try {
        await authedFetch(`/pricing/recommendations/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ org_id: orgId, status: action }),
        });
        setRecommendations((prev) => prev.filter((r) => r.id !== id));
        toast.success(
          action === "approved"
            ? isEn
              ? "Rate applied"
              : "Tarifa aplicada"
            : isEn
              ? "Dismissed"
              : "Descartado"
        );
      } catch {
        toast.error(
          isEn
            ? "Failed to update recommendation"
            : "Error al actualizar recomendación"
        );
      } finally {
        setUpdating(null);
      }
    },
    [orgId, isEn]
  );

  const handleFilterChange = useCallback(
    (status: string) => {
      setStatusFilter(status);
      refresh(status);
    },
    [refresh]
  );

  const totalImpact = recommendations.reduce(
    (sum, r) => sum + (r.revenue_impact_estimate ?? 0),
    0
  );
  const avgConfidence =
    recommendations.length > 0
      ? recommendations.reduce((sum, r) => sum + r.confidence, 0) /
        recommendations.length
      : 0;

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return "text-green-600 dark:text-green-400";
    if (c >= 0.6) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  if (recommendations.length === 0 && statusFilter === "pending") {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 h-10 w-10 animate-pulse rounded-full bg-primary/10" />
        <p className="font-medium text-sm">
          {isEn
            ? "Your AI pricing engine is analyzing market data..."
            : "Tu motor de precios IA está analizando datos del mercado..."}
        </p>
        <p className="mt-1 max-w-sm text-muted-foreground text-xs">
          {isEn
            ? "Recommendations will appear here when the agent identifies rate optimization opportunities."
            : "Las recomendaciones aparecerán aquí cuando el agente identifique oportunidades de optimización de tarifas."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary bar */}
      {statusFilter === "pending" && recommendations.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border/50 p-3">
            <p className="text-muted-foreground text-xs">
              {isEn ? "Pending" : "Pendientes"}
            </p>
            <p className="mt-0.5 font-semibold text-2xl tabular-nums">
              {recommendations.length}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 p-3">
            <p className="text-muted-foreground text-xs">
              {isEn ? "Total Revenue Impact" : "Impacto Total de Ingresos"}
            </p>
            <p
              className={`mt-0.5 font-semibold text-2xl tabular-nums ${
                totalImpact >= 0
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {totalImpact >= 0 ? "+" : ""}
              {formatCurrency(Math.round(totalImpact), "PYG", locale)}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 p-3">
            <p className="text-muted-foreground text-xs">
              {isEn ? "Avg Confidence" : "Confianza Promedio"}
            </p>
            <p
              className={`mt-0.5 font-semibold text-2xl tabular-nums ${confidenceColor(avgConfidence)}`}
            >
              {(avgConfidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1">
        {(["pending", "approved", "dismissed"] as const).map((s) => (
          <Button
            key={s}
            onClick={() => handleFilterChange(s)}
            size="sm"
            variant={statusFilter === s ? "default" : "outline"}
          >
            {s === "pending"
              ? isEn
                ? "Pending"
                : "Pendiente"
              : s === "approved"
                ? isEn
                  ? "Approved"
                  : "Aprobado"
                : isEn
                  ? "Dismissed"
                  : "Descartado"}
          </Button>
        ))}
      </div>

      {recommendations.length === 0 && (
        <p className="py-4 text-muted-foreground text-sm">
          {isEn
            ? "No pricing recommendations in this status."
            : "No hay recomendaciones de precios en este estado."}
        </p>
      )}

      {/* Recommendation cards */}
      <div className="space-y-3">
        {recommendations.map((rec) => (
          <div
            className="rounded-lg border border-border/50 p-4 transition-colors hover:border-border"
            key={rec.id}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="shrink-0 text-xs" variant="outline">
                    {rec.recommendation_type.replace(/_/g, " ")}
                  </Badge>
                  {rec.date_range_start && rec.date_range_end && (
                    <span className="text-muted-foreground text-xs">
                      {rec.date_range_start} → {rec.date_range_end}
                    </span>
                  )}
                </div>

                {/* Rate comparison */}
                {rec.current_rate != null && rec.recommended_rate != null && (
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="text-lg text-muted-foreground tabular-nums line-through">
                      {formatCurrency(
                        Math.round(rec.current_rate),
                        "PYG",
                        locale
                      )}
                    </span>
                    <span className="font-bold text-2xl tabular-nums">
                      {formatCurrency(
                        Math.round(rec.recommended_rate),
                        "PYG",
                        locale
                      )}
                    </span>
                    {rec.revenue_impact_estimate != null && (
                      <span
                        className={`font-medium text-sm ${
                          rec.revenue_impact_estimate >= 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {rec.revenue_impact_estimate >= 0 ? "+" : ""}
                        {formatCurrency(
                          Math.round(rec.revenue_impact_estimate),
                          "PYG",
                          locale
                        )}{" "}
                        {isEn ? "impact" : "impacto"}
                      </span>
                    )}
                  </div>
                )}

                {/* Confidence bar */}
                <div className="flex items-center gap-2">
                  <Progress
                    className="h-1.5 w-24"
                    value={rec.confidence * 100}
                  />
                  <span
                    className={`font-medium text-xs ${confidenceColor(rec.confidence)}`}
                  >
                    {(rec.confidence * 100).toFixed(0)}%{" "}
                    {isEn ? "confidence" : "confianza"}
                  </span>
                </div>

                <p className="text-muted-foreground text-sm leading-relaxed">
                  {rec.reasoning}
                </p>

                <p className="text-[11px] text-muted-foreground">
                  {rec.agent_slug} ·{" "}
                  {new Date(rec.created_at).toLocaleDateString(locale)}
                </p>
              </div>

              {statusFilter === "pending" && (
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Button
                    disabled={updating === rec.id}
                    onClick={() => handleAction(rec.id, "approved")}
                    size="sm"
                  >
                    {isEn ? "Apply" : "Aplicar"}
                  </Button>
                  <Button
                    disabled={updating === rec.id}
                    onClick={() => handleAction(rec.id, "dismissed")}
                    size="sm"
                    variant="ghost"
                  >
                    {isEn ? "Dismiss" : "Descartar"}
                  </Button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
