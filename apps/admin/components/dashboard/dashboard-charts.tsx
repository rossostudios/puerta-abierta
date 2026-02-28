"use client";

import Link from "next/link";
import {
  LazyOccupancyForecast,
  LazyOperationsHealthCard,
  LazyRevenueSnapshotCard,
  LazyRevenueTrend,
  LazyTaskStatusCard,
} from "@/components/dashboard/lazy";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  OccupancyForecastResponse,
  RevenueTrendResponse,
} from "@/lib/api";
import type { Locale } from "@/lib/i18n";

import type { OperationsKpis, RevenueSnapshot } from "./dashboard-utils";

export type CollectionHealthSnapshot = {
  totalCollections: number;
  paidCollections: number;
  pendingCollections: number;
  overdueCollections: number;
  collectionRatePct: number;
  avgDaysLate: number;
};

type DashboardFinancialPanelsProps = {
  locale: Locale;
  revenueSnapshot: RevenueSnapshot;
  revenueTrendData: RevenueTrendResponse;
  apiAvailable: boolean;
  collectionHealth: CollectionHealthSnapshot;
};

type DashboardOperationsPanelsProps = {
  locale: Locale;
  operationsKpis: OperationsKpis;
  taskStatuses: { status: string; count: number }[];
  apiAvailable: boolean;
  forecastData: OccupancyForecastResponse;
};

export function DashboardFinancialPanels({
  locale,
  revenueSnapshot,
  revenueTrendData,
  apiAvailable,
  collectionHealth,
}: DashboardFinancialPanelsProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <PaymentsHealthCard collectionHealth={collectionHealth} locale={locale} />
      <LazyRevenueSnapshotCard locale={locale} revenue={revenueSnapshot} />
      {apiAvailable ? (
        <LazyRevenueTrend data={revenueTrendData.months} locale={locale} />
      ) : null}
    </section>
  );
}

export function DashboardOperationsPanels({
  locale,
  operationsKpis,
  taskStatuses,
  apiAvailable,
  forecastData,
}: DashboardOperationsPanelsProps) {
  return (
    <section className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <LazyOperationsHealthCard
        locale={locale}
        operationsSummary={{
          turnoversDue: operationsKpis.turnoversDue,
          turnoversOnTime: operationsKpis.turnoversOnTime,
          turnoverOnTimeRate: operationsKpis.turnoverOnTimeRate,
          overdueTasks: operationsKpis.overdueTasks,
          slaBreachedTasks: operationsKpis.slaBreachedTasks,
        }}
      />
      <LazyTaskStatusCard locale={locale} taskStatuses={taskStatuses} />
      {apiAvailable ? (
        <LazyOccupancyForecast
          avgPct={forecastData.historical_avg_occupancy_pct}
          data={forecastData.months}
          locale={locale}
        />
      ) : null}
    </section>
  );
}

function PaymentsHealthCard({
  locale,
  collectionHealth,
}: {
  locale: Locale;
  collectionHealth: CollectionHealthSnapshot;
}) {
  const isEn = locale === "en-US";
  const total = collectionHealth.totalCollections;
  const paid = collectionHealth.paidCollections;
  const pending = collectionHealth.pendingCollections;
  const overdue = collectionHealth.overdueCollections;
  const hasCollections = total > 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader className="space-y-3 border-border/70 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">
              {isEn ? "Payments health" : "Salud de pagos"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Payment performance this month"
                : "Rendimiento de pagos este mes"}
            </CardDescription>
          </div>
          <Badge className="font-mono text-[11px]" variant="outline">
            {collectionHealth.collectionRatePct.toFixed(1)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
              {isEn ? "Paid" : "Pagadas"}
            </p>
            <p className="mt-1 font-semibold text-xl tabular-nums">{paid}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
              {isEn ? "Pending" : "Pendientes"}
            </p>
            <p className="mt-1 font-semibold text-xl tabular-nums">{pending}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
              {isEn ? "Overdue" : "Vencidas"}
            </p>
            <p className="mt-1 font-semibold text-xl tabular-nums">{overdue}</p>
          </div>
          <div className="rounded-xl border border-border/60 bg-muted/15 p-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-[0.12em]">
              {isEn ? "Avg days late" : "Prom días tarde"}
            </p>
            <p className="mt-1 font-semibold text-xl tabular-nums">
              {collectionHealth.avgDaysLate.toFixed(1)}d
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {hasCollections
              ? isEn
                ? `${paid}/${total} payments received this period`
                : `${paid}/${total} pagos recibidos en el periodo actual`
              : isEn
                ? "No payments recorded yet"
                : "Aún no hay pagos registrados"}
          </span>
          <Link
            className="font-medium text-[var(--sidebar-primary)] hover:underline"
            href="/module/collections"
          >
            {isEn ? "Review payments" : "Revisar pagos"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
