"use client";

import { Bar, BarChart, YAxis } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PropertyOverview as PropertyOverviewData } from "../types";

type PropertyOverviewKpiCardsProps = {
  overview: PropertyOverviewData;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

/* ---------- threshold color helpers ---------- */

function occupancyColor(rate: number | null) {
  if (rate === null) return "";
  if (rate >= 80) return "text-[var(--status-success-fg)]";
  if (rate >= 50) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
}

function occupancyBorderColor(rate: number | null) {
  if (rate === null) return "border-t-transparent";
  if (rate >= 80) return "border-t-[var(--status-success-fg)]";
  if (rate >= 50) return "border-t-[var(--status-warning-fg)]";
  return "border-t-[var(--status-danger-fg)]";
}

function collectionRateColor(rate: number | null) {
  if (rate === null) return "";
  if (rate >= 80) return "text-[var(--status-success-fg)]";
  if (rate >= 50) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
}

/* ---------- mini bar component ---------- */

type MiniBarProps = {
  a: number;
  b: number;
  colorA: string;
  colorB: string;
};

const EMPTY_CONFIG: ChartConfig = {
  a: { label: "A", color: "var(--border)" },
  b: { label: "B", color: "transparent" },
};

function MiniBar({ a, b, colorA, colorB }: MiniBarProps) {
  const isEmpty = a === 0 && b === 0;

  const config: ChartConfig = isEmpty
    ? EMPTY_CONFIG
    : {
        a: { label: "A", color: colorA },
        b: { label: "B", color: colorB },
      };

  const data = isEmpty ? [{ a: 1, b: 0 }] : [{ a, b }];

  return (
    <ChartContainer className="h-10 w-full" config={config}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
        stackOffset="expand"
      >
        <YAxis dataKey="a" hide type="category" />
        <Bar
          dataKey="a"
          fill="var(--color-a)"
          radius={[4, 0, 0, 4]}
          stackId="stack"
          isAnimationActive={false}
        />
        <Bar
          dataKey="b"
          fill="var(--color-b)"
          radius={[0, 4, 4, 0]}
          stackId="stack"
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  );
}

/* ---------- main component ---------- */

export function PropertyOverviewKpiCards({
  overview,
  locale,
  isEn,
}: PropertyOverviewKpiCardsProps) {
  const oRate = overview.occupancyRate;

  const occupiedUnits = overview.unitCount - overview.vacantUnitCount;
  const projectedRemaining = Math.max(
    overview.projectedRentPyg - overview.collectedThisMonthPyg,
    0
  );
  const leaseCapacity = Math.max(
    overview.unitCount - overview.activeLeaseCount,
    0
  );
  const nonUrgentTasks = Math.max(
    overview.openTaskCount - overview.urgentTaskCount,
    0
  );
  const currentCollections = Math.max(
    overview.openCollectionCount - overview.overdueCollectionCount,
    0
  );

  const taskColor =
    overview.openTaskCount > 0 ? "text-[var(--status-warning-fg)]" : "";
  const taskBorder =
    overview.openTaskCount > 0
      ? "border-t-[var(--status-warning-fg)]"
      : "border-t-transparent";

  const collectionColor =
    overview.overdueCollectionCount > 0
      ? "text-[var(--status-danger-fg)]"
      : overview.openCollectionCount > 0
        ? "text-[var(--status-warning-fg)]"
        : "";
  const collectionBorder =
    overview.overdueCollectionCount > 0
      ? "border-t-[var(--status-danger-fg)]"
      : overview.openCollectionCount > 0
        ? "border-t-[var(--status-warning-fg)]"
        : "border-t-transparent";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {/* Occupancy */}
      <Card
        className={cn(
          "border-border/60 bg-card/95 backdrop-blur-sm border-t-2",
          occupancyBorderColor(oRate)
        )}
      >
        <CardContent className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isEn ? "OCCUPANCY" : "OCUPACIÓN"}
          </p>
          <p
            className={cn(
              "mt-1 font-bold text-3xl tabular-nums",
              occupancyColor(oRate)
            )}
          >
            {oRate !== null ? `${oRate}%` : "-"}
          </p>
          <div className="mt-3">
            <MiniBar
              a={occupiedUnits}
              b={overview.vacantUnitCount}
              colorA="var(--status-success-fg)"
              colorB="oklch(from var(--status-danger-fg) l c h / 0.3)"
            />
          </div>
          {overview.vacantUnitCount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {overview.vacantUnitCount} {isEn ? "vacant" : "vacantes"} &middot;
              ~{formatCompactCurrency(overview.vacancyCostPyg, "PYG", locale)}
              {isEn ? "/mo lost" : "/mes perdido"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Projected Rent */}
      <Card className="border-border/60 bg-card/95 backdrop-blur-sm border-t-2 border-t-transparent">
        <CardContent className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isEn ? "PROJECTED RENT" : "RENTA PROYECTADA"}
          </p>
          <p className="mt-1 font-bold text-3xl tabular-nums">
            {formatCurrency(overview.projectedRentPyg, "PYG", locale)}
          </p>
          <div className="mt-3">
            <MiniBar
              a={overview.collectedThisMonthPyg}
              b={projectedRemaining}
              colorA="var(--status-success-fg)"
              colorB="var(--chart-3)"
            />
          </div>
          {overview.collectionRate !== null ? (
            <p
              className={cn(
                "mt-2 text-xs font-medium",
                collectionRateColor(overview.collectionRate)
              )}
            >
              {overview.collectionRate}% {isEn ? "collected" : "cobrado"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Active Leases */}
      <Card className="border-border/60 bg-card/95 backdrop-blur-sm border-t-2 border-t-transparent">
        <CardContent className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isEn ? "ACTIVE LEASES" : "CONTRATOS ACTIVOS"}
          </p>
          <p className="mt-1 font-bold text-3xl tabular-nums">
            {overview.activeLeaseCount}
          </p>
          <div className="mt-3">
            <MiniBar
              a={overview.activeLeaseCount}
              b={leaseCapacity}
              colorA="var(--chart-1)"
              colorB="var(--border)"
            />
          </div>
          {overview.activeReservationCount > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              +{overview.activeReservationCount}{" "}
              {isEn ? "reservations" : "reservas"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Open Tasks */}
      <Card
        className={cn(
          "border-border/60 bg-card/95 backdrop-blur-sm border-t-2",
          taskBorder
        )}
      >
        <CardContent className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isEn ? "OPEN TASKS" : "TAREAS ABIERTAS"}
          </p>
          <p className={cn("mt-1 font-bold text-3xl tabular-nums", taskColor)}>
            {overview.openTaskCount}
          </p>
          <div className="mt-3">
            <MiniBar
              a={overview.urgentTaskCount}
              b={nonUrgentTasks}
              colorA="var(--status-danger-fg)"
              colorB="var(--status-warning-fg)"
            />
          </div>
          {overview.urgentTaskCount > 0 ? (
            <p className="mt-2 text-xs font-medium text-[var(--status-danger-fg)]">
              {overview.urgentTaskCount} {isEn ? "urgent" : "urgentes"}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Open Collections */}
      <Card
        className={cn(
          "border-border/60 bg-card/95 backdrop-blur-sm border-t-2",
          collectionBorder
        )}
      >
        <CardContent className="p-5">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {isEn ? "OPEN COLLECTIONS" : "COBROS ABIERTOS"}
          </p>
          <p
            className={cn(
              "mt-1 font-bold text-3xl tabular-nums",
              collectionColor
            )}
          >
            {overview.openCollectionCount}
          </p>
          <div className="mt-3">
            <MiniBar
              a={overview.overdueCollectionCount}
              b={currentCollections}
              colorA="var(--status-danger-fg)"
              colorB="var(--status-warning-fg)"
            />
          </div>
          {overview.overdueCollectionCount > 0 ? (
            <p className="mt-2 text-xs font-medium text-[var(--status-danger-fg)]">
              {overview.overdueCollectionCount}{" "}
              {isEn ? "overdue" : "vencidos"}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
