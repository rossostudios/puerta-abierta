"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SecurityMetrics = {
  total_interactions: number;
  pii_intercepts: number;
  boundary_violations: number;
  approval_overrides: number;
  avg_response_time_ms: number;
  timeline: Array<{
    date: string;
    interactions: number;
    pii_intercepts: number;
    violations: number;
  }>;
};

type SecurityAuditProps = {
  orgId: string;
  isEn: boolean;
};

export function SecurityAudit({ orgId, isEn }: SecurityAuditProps) {
  const { data: metrics, isPending: loading } = useQuery<SecurityMetrics>({
    queryKey: ["security-audit", orgId],
    queryFn: async () => {
      const res = await fetch(
        `/api/agent/security-audit?org_id=${encodeURIComponent(orgId)}`,
        { cache: "no-store", headers: { Accept: "application/json" } }
      );
      if (!res.ok)
        return {
          total_interactions: 0,
          pii_intercepts: 0,
          boundary_violations: 0,
          approval_overrides: 0,
          avg_response_time_ms: 0,
          timeline: [],
        };
      return (await res.json()) as SecurityMetrics;
    },
    staleTime: 60_000,
  });

  const handleExport = async () => {
    const res = await fetch(
      `/api/agent/security-audit/export?org_id=${encodeURIComponent(orgId)}`,
      { headers: { Accept: "text/csv" } }
    );
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `security-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const METRIC_CARDS = [
    {
      labelEn: "Total Interactions",
      labelEs: "Interacciones Totales",
      value: metrics?.total_interactions ?? 0,
      color: "text-foreground",
    },
    {
      labelEn: "PII Intercepts",
      labelEs: "Intercepciones PII",
      value: metrics?.pii_intercepts ?? 0,
      color:
        (metrics?.pii_intercepts ?? 0) > 0
          ? "text-amber-600 dark:text-amber-400"
          : "text-foreground",
    },
    {
      labelEn: "Boundary Violations",
      labelEs: "Violaciones de Limites",
      value: metrics?.boundary_violations ?? 0,
      color:
        (metrics?.boundary_violations ?? 0) > 0
          ? "text-red-600 dark:text-red-400"
          : "text-foreground",
    },
    {
      labelEn: "Approval Overrides",
      labelEs: "Aprobaciones Anuladas",
      value: metrics?.approval_overrides ?? 0,
      color: "text-foreground",
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-border/70 border-b pb-4">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {isEn ? "Security Overview" : "Resumen de Seguridad"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Aggregated security metrics for the past 30 days"
                : "Métricas de seguridad agregadas de los últimos 30 días"}
            </CardDescription>
          </div>
          <Button
            onClick={() => {
              handleExport().catch(() => undefined);
            }}
            size="sm"
            variant="outline"
          >
            {isEn ? "Export CSV" : "Exportar CSV"}
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {loading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[1, 2, 3, 4].map((k) => (
                <Skeleton className="h-20 rounded-xl" key={k} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {METRIC_CARDS.map((card) => (
                <div
                  className="rounded-xl border border-border/30 bg-muted/10 px-4 py-3"
                  key={card.labelEn}
                >
                  <p className="font-medium text-[11px] text-muted-foreground/60 uppercase tracking-wider">
                    {isEn ? card.labelEn : card.labelEs}
                  </p>
                  <p className={cn("mt-1 font-semibold text-2xl", card.color)}>
                    {card.value.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {metrics?.timeline && metrics.timeline.length > 0 ? (
        <Card>
          <CardHeader className="border-border/70 border-b pb-4">
            <CardTitle className="text-base">
              {isEn ? "Activity Timeline" : "Linea de Tiempo"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-1.5">
              {metrics.timeline.slice(0, 14).map((day) => (
                <div
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted/10 px-3 py-2"
                  key={day.date}
                >
                  <span className="font-mono text-[11.5px] text-muted-foreground/70">
                    {day.date}
                  </span>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="text-foreground/70">
                      {day.interactions}{" "}
                      {isEn ? "interactions" : "interacciones"}
                    </span>
                    {day.pii_intercepts > 0 ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        {day.pii_intercepts} PII
                      </span>
                    ) : null}
                    {day.violations > 0 ? (
                      <span className="text-red-600 dark:text-red-400">
                        {day.violations} {isEn ? "violations" : "violaciones"}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
