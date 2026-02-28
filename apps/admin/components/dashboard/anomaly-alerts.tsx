"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useMounted } from "@/lib/hooks/use-mounted";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

type SuggestedAction = {
  label: string;
  href?: string;
  agent_action?: string;
};

type AnomalyAlert = {
  id: string;
  alert_type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  description?: string;
  detected_at: string;
  suggested_actions?: SuggestedAction[];
};

type AnomalyAlertsProps = {
  orgId: string;
  locale: Locale;
  promoted?: boolean;
};

const SEVERITY_STYLES: Record<string, string> = {
  info: "border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-400",
  warning:
    "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  critical: "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400",
};

const SEVERITY_DOT: Record<string, string> = {
  info: "bg-blue-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
};

export function AnomalyAlerts({
  orgId,
  locale: localeProp,
  promoted = false,
}: AnomalyAlertsProps) {
  "use no memo";
  const activeLocale = useActiveLocale();
  const mounted = useMounted();
  const queryClient = useQueryClient();

  const locale = mounted ? activeLocale : localeProp;
  const isEn = locale === "en-US";

  const today = new Date().toISOString().slice(0, 10);

  const { data: alerts = [], isPending: loading } = useQuery({
    queryKey: ["anomaly-alerts", orgId, today],
    queryFn: async () => {
      const url = `/api/reports/anomalies?org_id=${encodeURIComponent(orgId)}&from_date=${today}&to_date=${today}`;
      const response = await fetch(url, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as { data?: AnomalyAlert[] };
      return payload.data ?? [];
    },
  });

  const dismissAlert = async (alertId: string) => {
    try {
      await fetch(
        `/api/reports/anomalies/${alertId}/dismiss?org_id=${encodeURIComponent(orgId)}&from_date=${today}&to_date=${today}`,
        { method: "POST", headers: { Accept: "application/json" } }
      );
      queryClient.setQueryData(
        ["anomaly-alerts", orgId, today],
        (prev: AnomalyAlert[] | undefined) =>
          prev ? prev.filter((a) => a.id !== alertId) : []
      );
    } catch {
      // silently fail
    }
  };

  if (loading || alerts.length === 0) return null;

  const hasCritical = alerts.some((a) => a.severity === "critical");

  return (
    <Card
      className={cn(
        "overflow-hidden",
        promoted && hasCritical && "animate-pulse ring-2 ring-red-500/30"
      )}
    >
      <CardHeader className="space-y-3 border-border/70 border-b pb-4">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {isEn ? "Anomaly alerts" : "Alertas de anomalías"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Detected issues requiring attention"
              : "Problemas detectados que requieren atención"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {alerts.map((alert) => (
          <div
            className={cn(
              "rounded-xl border p-3",
              SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info
            )}
            key={alert.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full",
                    SEVERITY_DOT[alert.severity] ?? SEVERITY_DOT.info
                  )}
                />
                <div>
                  <p className="font-medium text-sm">{alert.title}</p>
                  {alert.description ? (
                    <p className="mt-0.5 text-[12px] opacity-80">
                      {alert.description}
                    </p>
                  ) : null}
                </div>
              </div>
              <Button
                className="shrink-0"
                onClick={() => {
                  dismissAlert(alert.id).catch(() => undefined);
                }}
                size="sm"
                variant="ghost"
              >
                {isEn ? "Dismiss" : "Descartar"}
              </Button>
            </div>
            {alert.suggested_actions?.length ? (
              <div className="mt-2 ml-4.5 flex flex-wrap gap-1.5">
                {alert.suggested_actions.map((sa) =>
                  sa.href ? (
                    <Button
                      asChild
                      className="h-7 text-[11px]"
                      key={sa.label}
                      size="sm"
                      variant="outline"
                    >
                      <Link href={sa.href}>{sa.label}</Link>
                    </Button>
                  ) : (
                    <Button
                      className="h-7 text-[11px]"
                      key={sa.label}
                      onClick={() => {
                        if (sa.agent_action) {
                          window.location.href = `/app/agents?q=${encodeURIComponent(sa.agent_action)}`;
                        }
                      }}
                      size="sm"
                      variant="outline"
                    >
                      {sa.label}
                    </Button>
                  )
                )}
              </div>
            ) : null}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
