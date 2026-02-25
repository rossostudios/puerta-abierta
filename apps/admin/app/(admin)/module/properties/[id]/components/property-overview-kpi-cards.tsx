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
  if (rate === null) return "";
  if (rate >= 80) return "text-[var(--status-success-fg)]";
  if (rate >= 50) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
}

function collectionRateColor(rate: number | null) {
  if (rate === null) return "";
  if (rate >= 80) return "text-[var(--status-success-fg)]";
  if (rate >= 50) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
}

/* ---------- divider ---------- */

function Divider() {
  return (
    <span
      aria-hidden="true"
      className="hidden h-5 w-px bg-border/60 sm:block"
    />
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
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border/50 pb-4">
      {/* Occupancy */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {isEn ? "OCCUPANCY" : "OCUPACIÓN"}
        </span>
        <span
          className={cn(
            "font-bold text-xl tabular-nums",
            occupancyColor(oRate)
          )}
        >
          {oRate !== null ? `${oRate}%` : "-"}
        </span>
        {overview.vacantUnitCount > 0 && (
          <span className="text-muted-foreground text-xs">
            {overview.vacantUnitCount} {isEn ? "vacant" : "vacantes"}
          </span>
        )}
      </div>

      <Divider />

      {/* Projected Rent */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {isEn ? "RENT" : "RENTA"}
        </span>
        <span className="font-bold text-xl tabular-nums">
          {formatCompactCurrency(overview.projectedRentPyg, "PYG", locale)}
        </span>
        {overview.collectionRate !== null && (
          <span
            className={cn(
              "font-medium text-xs",
              collectionRateColor(overview.collectionRate)
            )}
          >
            {overview.collectionRate}% {isEn ? "collected" : "cobrado"}
          </span>
        )}
      </div>

      <Divider />

      {/* Active Leases */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {isEn ? "LEASES" : "CONTRATOS"}
        </span>
        <span className="font-bold text-xl tabular-nums">
          {overview.activeLeaseCount}
        </span>
        {overview.activeReservationCount > 0 && (
          <span className="text-muted-foreground text-xs">
            +{overview.activeReservationCount} {isEn ? "reservations" : "reservas"}
          </span>
        )}
      </div>

      <Divider />

      {/* Open Tasks */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {isEn ? "TASKS" : "TAREAS"}
        </span>
        <span className={cn("font-bold text-xl tabular-nums", taskColor)}>
          {overview.openTaskCount}
        </span>
        {overview.urgentTaskCount > 0 && (
          <span className="font-medium text-[var(--status-danger-fg)] text-xs">
            {overview.urgentTaskCount} {isEn ? "urgent" : "urgentes"}
          </span>
        )}
      </div>

      <Divider />

      {/* Open Collections */}
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
          {isEn ? "COLLECTIONS" : "COBROS"}
        </span>
        <span
          className={cn("font-bold text-xl tabular-nums", collectionColor)}
        >
          {overview.openCollectionCount}
        </span>
        {overview.overdueCollectionCount > 0 && (
          <span className="font-medium text-[var(--status-danger-fg)] text-xs">
            {overview.overdueCollectionCount} {isEn ? "overdue" : "vencidos"}
          </span>
        )}
      </div>
    </div>
  );
}
