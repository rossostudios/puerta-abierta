"use client";

import {
  LazyAgentPerformance,
  LazyDashboardInsights,
  LazyOccupancyForecast,
  LazyRevenueTrend,
} from "@/components/dashboard/lazy";
import type {
  AgentPerformanceStats,
  OccupancyForecastResponse,
  RevenueTrendResponse,
} from "@/lib/api";
import type { Locale } from "@/lib/i18n";

import type { OperationsKpis, RevenueSnapshot } from "./dashboard-utils";

type DashboardChartsProps = {
  locale: Locale;
  operationsKpis: OperationsKpis;
  revenueSnapshot: RevenueSnapshot;
  taskStatuses: { status: string; count: number }[];
  apiAvailable: boolean;
  forecastData: OccupancyForecastResponse;
  revenueTrendData: RevenueTrendResponse;
  agentPerfData: AgentPerformanceStats | null;
};

export function DashboardCharts({
  locale,
  operationsKpis,
  revenueSnapshot,
  taskStatuses,
  apiAvailable,
  forecastData,
  revenueTrendData,
  agentPerfData,
}: DashboardChartsProps) {
  return (
    <>
      <LazyDashboardInsights
        locale={locale}
        operationsSummary={{
          turnoversDue: operationsKpis.turnoversDue,
          turnoversOnTime: operationsKpis.turnoversOnTime,
          turnoverOnTimeRate: operationsKpis.turnoverOnTimeRate,
          overdueTasks: operationsKpis.overdueTasks,
          slaBreachedTasks: operationsKpis.slaBreachedTasks,
        }}
        revenue={revenueSnapshot}
        taskStatuses={taskStatuses}
      />

      {apiAvailable ? (
        <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <LazyOccupancyForecast
            data={forecastData.months}
            avgPct={forecastData.historical_avg_occupancy_pct}
            locale={locale}
          />
          <LazyRevenueTrend data={revenueTrendData.months} locale={locale} />
          <LazyAgentPerformance data={agentPerfData} locale={locale} />
        </section>
      ) : null}
    </>
  );
}
