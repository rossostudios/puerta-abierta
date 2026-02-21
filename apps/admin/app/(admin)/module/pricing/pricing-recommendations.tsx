"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { authedFetch } from "@/lib/api-client";

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

export function PricingRecommendations({
  orgId,
  initialRecommendations,
  locale,
}: Props) {
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
      } catch (err) {
        console.error("Failed to update recommendation:", err);
      } finally {
        setUpdating(null);
      }
    },
    [orgId]
  );

  const handleFilterChange = useCallback(
    (status: string) => {
      setStatusFilter(status);
      refresh(status);
    },
    [refresh]
  );

  const confidenceColor = (c: number) => {
    if (c >= 0.8) return "text-green-600";
    if (c >= 0.6) return "text-amber-600";
    return "text-red-600";
  };

  const formatRate = (rate?: number | null) => {
    if (rate == null) return "—";
    return `$${rate.toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1">
        {(["pending", "approved", "dismissed"] as const).map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            onClick={() => handleFilterChange(s)}
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
        <p className="text-sm text-muted-foreground py-4">
          {isEn
            ? "No pricing recommendations in this status."
            : "No hay recomendaciones de precios en este estado."}
        </p>
      )}

      <div className="space-y-3">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="rounded-lg border p-4 space-y-2"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-xs shrink-0">
                    {rec.recommendation_type.replace(/_/g, " ")}
                  </Badge>
                  <span
                    className={`text-xs font-medium ${confidenceColor(rec.confidence)}`}
                  >
                    {(rec.confidence * 100).toFixed(0)}%{" "}
                    {isEn ? "confidence" : "confianza"}
                  </span>
                  {rec.date_range_start && rec.date_range_end && (
                    <span className="text-xs text-muted-foreground">
                      {rec.date_range_start} → {rec.date_range_end}
                    </span>
                  )}
                </div>

                {/* Rate comparison */}
                {rec.current_rate != null && rec.recommended_rate != null && (
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-sm text-muted-foreground line-through">
                      {formatRate(rec.current_rate)}
                    </span>
                    <span className="text-sm font-semibold">
                      {formatRate(rec.recommended_rate)}
                    </span>
                    {rec.revenue_impact_estimate != null && (
                      <span
                        className={`text-xs ${
                          rec.revenue_impact_estimate >= 0
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {rec.revenue_impact_estimate >= 0 ? "+" : ""}$
                        {rec.revenue_impact_estimate.toFixed(2)}{" "}
                        {isEn ? "impact" : "impacto"}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                  {rec.reasoning}
                </p>
              </div>

              {statusFilter === "pending" && (
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    size="sm"
                    disabled={updating === rec.id}
                    onClick={() => handleAction(rec.id, "approved")}
                  >
                    {isEn ? "Approve" : "Aprobar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={updating === rec.id}
                    onClick={() => handleAction(rec.id, "dismissed")}
                  >
                    {isEn ? "Dismiss" : "Descartar"}
                  </Button>
                </div>
              )}
            </div>

            <div className="text-[11px] text-muted-foreground">
              {rec.agent_slug} · {new Date(rec.created_at).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
