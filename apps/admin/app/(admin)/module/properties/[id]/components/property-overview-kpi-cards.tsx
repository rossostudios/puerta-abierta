import { formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PropertyOverview as PropertyOverviewData } from "../types";

type PropertyOverviewKpiCardsProps = {
  overview: PropertyOverviewData;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

/* ---------- threshold color helpers ---------- */

function occupancyColor(rate: number | null) {
  if (rate === null) return "text-foreground";
  if (rate >= 80) return "text-[var(--status-success-fg)]";
  if (rate >= 50) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
}

/* ---------- KPI card ---------- */

function KpiCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1 rounded-2xl border border-border/60 bg-card p-4">
      <span className="font-semibold text-[10px] text-muted-foreground/70 uppercase tracking-[0.1em]">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">{children}</div>
    </div>
  );
}

/* ---------- main component ---------- */

export function PropertyOverviewKpiCards({
  overview,
  locale,
  isEn,
}: PropertyOverviewKpiCardsProps) {
  const oRate = overview.occupancyRate;

  const taskColor =
    overview.openTaskCount > 0 ? "text-[var(--status-warning-fg)]" : "";

  const collectionColor =
    overview.overdueCollectionCount > 0
      ? "text-[var(--status-danger-fg)]"
      : overview.openCollectionCount > 0
        ? "text-[var(--status-warning-fg)]"
        : "";

  return (
    <div className="flex flex-wrap gap-3">
      {/* Occupancy */}
      <KpiCard label={isEn ? "Occupancy" : "Ocupación"}>
        <span
          className={cn(
            "font-extrabold text-[28px] tabular-nums leading-8 tracking-tight",
            occupancyColor(oRate)
          )}
        >
          {oRate !== null ? `${oRate}%` : "-"}
        </span>
        {overview.vacantUnitCount > 0 && (
          <span
            className={cn(
              "text-xs font-medium",
              oRate !== null && oRate < 50
                ? "text-[var(--status-danger-fg)]"
                : "text-muted-foreground"
            )}
          >
            {overview.vacantUnitCount} {isEn ? "vacant" : "vacantes"}
          </span>
        )}
      </KpiCard>

      {/* Projected Rent */}
      <KpiCard label={isEn ? "Monthly Rent" : "Renta Mensual"}>
        <span className="font-extrabold text-[28px] tabular-nums leading-8 tracking-tight">
          {formatCompactCurrency(overview.projectedRentPyg, "PYG", locale)}
        </span>
        {overview.collectionRate !== null && (
          <span
            className={cn(
              "font-medium text-xs",
              overview.collectionRate >= 80
                ? "text-[var(--status-success-fg)]"
                : overview.collectionRate >= 50
                  ? "text-[var(--status-warning-fg)]"
                  : "text-[var(--status-danger-fg)]"
            )}
          >
            {overview.collectionRate}% {isEn ? "collected" : "cobrado"}
          </span>
        )}
      </KpiCard>

      {/* Active Leases */}
      <KpiCard label={isEn ? "Active Leases" : "Contratos Activos"}>
        <span className="font-extrabold text-[28px] tabular-nums leading-8 tracking-tight">
          {overview.activeLeaseCount}
        </span>
        {overview.activeReservationCount > 0 && (
          <span className="text-muted-foreground text-xs">
            +{overview.activeReservationCount}{" "}
            {isEn ? "reservations" : "reservas"}
          </span>
        )}
      </KpiCard>

      {/* Open Tasks */}
      <KpiCard label={isEn ? "Open Tasks" : "Tareas Abiertas"}>
        <span
          className={cn(
            "font-extrabold text-[28px] tabular-nums leading-8 tracking-tight",
            taskColor
          )}
        >
          {overview.openTaskCount}
        </span>
        {overview.urgentTaskCount > 0 && (
          <span className="font-medium text-[var(--status-danger-fg)] text-xs">
            {overview.urgentTaskCount} {isEn ? "urgent" : "urgentes"}
          </span>
        )}
      </KpiCard>

      {/* Open Collections */}
      <KpiCard label={isEn ? "Collections" : "Cobros"}>
        <span
          className={cn(
            "font-extrabold text-[28px] tabular-nums leading-8 tracking-tight",
            collectionColor
          )}
        >
          {overview.openCollectionCount}
        </span>
        {overview.overdueCollectionCount > 0 && (
          <span className="font-medium text-[var(--status-danger-fg)] text-xs">
            {overview.overdueCollectionCount} {isEn ? "overdue" : "vencidos"}
          </span>
        )}
      </KpiCard>
    </div>
  );
}
