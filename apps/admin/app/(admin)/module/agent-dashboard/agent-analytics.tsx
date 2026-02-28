"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type AgentStat = {
  slug: string;
  total_runs: number;
  successful_runs: number;
  success_rate: number;
  total_tokens: number;
  estimated_cost_usd: number;
  avg_latency_ms: number;
  human_override_pct: number;
};

type ToolStat = {
  name: string;
  calls: number;
  success_rate: number;
};

type CostTrend = {
  date: string;
  cost_usd: number;
  token_count: number;
};

type AnalyticsData = {
  period_days: number;
  agents: AgentStat[];
  top_tools: ToolStat[];
  cost_trend: CostTrend[];
};

type Props = {
  orgId: string;
  locale: string;
};

const PERIODS = [1, 7, 30] as const;

export function AgentAnalytics({ orgId, locale }: Props) {
  const isEn = locale === "en-US";
  const [period, setPeriod] = useState<number>(7);
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAnalytics = useCallback(
    async (days: number) => {
      setLoading(true);
      try {
        const res = await authedFetch<AnalyticsData>(
          `/ai-agents/dashboard/analytics?org_id=${orgId}&period=${days}`
        );
        setData(res);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [orgId]
  );

  useEffect(() => {
    fetchAnalytics(period);
  }, [period, fetchAnalytics]);

  const handlePeriodChange = (days: number) => {
    setPeriod(days);
  };

  const maxCost = data?.cost_trend
    ? Math.max(...data.cost_trend.map((d) => d.cost_usd), 0.001)
    : 1;
  const maxToolCalls = data?.top_tools
    ? Math.max(...data.top_tools.map((t) => t.calls), 1)
    : 1;

  return (
    <div className="space-y-5">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-xs">
          {isEn ? "Period:" : "Periodo:"}
        </span>
        {PERIODS.map((d) => (
          <Button
            className={cn(
              "h-6 px-2.5 text-[11px]",
              period === d &&
                "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
            key={d}
            onClick={() => handlePeriodChange(d)}
            size="sm"
            variant={period === d ? "default" : "outline"}
          >
            {d}d
          </Button>
        ))}
      </div>

      {loading && (
        <p className="animate-pulse py-6 text-center text-muted-foreground text-sm">
          {isEn ? "Loading analytics..." : "Cargando analíticas..."}
        </p>
      )}

      {!(loading || data) && (
        <p className="py-6 text-center text-muted-foreground text-sm">
          {isEn
            ? "No analytics data available."
            : "No hay datos analíticos disponibles."}
        </p>
      )}

      {!loading && data && (
        <>
          {/* Agent Performance Table */}
          <div className="space-y-2">
            <h4 className="font-medium text-sm">
              {isEn ? "Agent Performance" : "Rendimiento de Agentes"}
            </h4>
            {data.agents.length === 0 ? (
              <p className="py-4 text-center text-muted-foreground text-xs">
                {isEn
                  ? "No agent traces in this period."
                  : "Sin trazas de agentes en este periodo."}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/50">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-border/40 border-b bg-muted/30">
                      <th className="px-3 py-2 font-medium text-muted-foreground text-xs">
                        {isEn ? "Agent" : "Agente"}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">
                        {isEn ? "Runs" : "Ejecuciones"}
                      </th>
                      <th className="px-3 py-2 font-medium text-muted-foreground text-xs">
                        {isEn ? "Success Rate" : "Tasa de Éxito"}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">
                        {isEn ? "Cost" : "Costo"}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">
                        {isEn ? "Avg Latency" : "Latencia Prom."}
                      </th>
                      <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs">
                        {isEn ? "Override %" : "% Anulación"}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {data.agents.map((agent) => (
                      <tr
                        className="transition-colors hover:bg-muted/20"
                        key={agent.slug}
                      >
                        <td className="px-3 py-2">
                          <Badge
                            className="font-normal text-[11px]"
                            variant="secondary"
                          >
                            {agent.slug}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {agent.total_runs}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  agent.success_rate >= 90
                                    ? "bg-emerald-500"
                                    : agent.success_rate >= 70
                                      ? "bg-amber-500"
                                      : "bg-red-500"
                                )}
                                style={{
                                  width: `${Math.min(agent.success_rate, 100)}%`,
                                }}
                              />
                            </div>
                            <span className="text-xs tabular-nums">
                              {agent.success_rate.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          ${agent.estimated_cost_usd.toFixed(4)}
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {agent.avg_latency_ms}ms
                        </td>
                        <td className="px-3 py-2 text-right text-xs tabular-nums">
                          {agent.human_override_pct.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Top Tools */}
          {data.top_tools.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">
                {isEn ? "Top Tools" : "Herramientas Más Usadas"}
              </h4>
              <div className="space-y-1.5">
                {data.top_tools.slice(0, 10).map((tool) => (
                  <div className="flex items-center gap-3" key={tool.name}>
                    <span className="w-40 truncate text-xs">
                      {tool.name.replace(/_/g, " ")}
                    </span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/50">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-primary/30"
                        style={{
                          width: `${(tool.calls / maxToolCalls) * 100}%`,
                        }}
                      />
                      <span className="relative z-10 flex h-full items-center px-2 text-[10px] tabular-nums">
                        {tool.calls} {isEn ? "calls" : "llamadas"} ·{" "}
                        {tool.success_rate.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cost Trend */}
          {data.cost_trend.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium text-sm">
                {isEn ? "Daily Cost Trend" : "Tendencia de Costos Diarios"}
              </h4>
              <div className="flex items-end gap-1" style={{ height: 80 }}>
                {data.cost_trend.map((day) => (
                  <div
                    className="group relative flex-1"
                    key={day.date}
                    style={{ height: "100%" }}
                  >
                    <div
                      className="absolute inset-x-0 bottom-0 rounded-t bg-primary/40 transition-colors group-hover:bg-primary/60"
                      style={{
                        height: `${Math.max((day.cost_usd / maxCost) * 100, 2)}%`,
                      }}
                    />
                    <div className="pointer-events-none absolute -top-5 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-popover px-1.5 py-0.5 text-[9px] text-popover-foreground shadow group-hover:block">
                      {day.date}: ${day.cost_usd.toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{data.cost_trend[0]?.date}</span>
                <span>{data.cost_trend.at(-1)?.date}</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
