import { Card, CardContent } from "@/components/ui/card";
import { formatCompactCurrency, formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PropertyOverview as PropertyOverviewData } from "../types";

type PropertyOverviewKpiCardsProps = {
  overview: PropertyOverviewData;
  locale: "en-US" | "es-PY";
  isEn: boolean;
};

export function PropertyOverviewKpiCards({
  overview,
  locale,
  isEn,
}: PropertyOverviewKpiCardsProps) {
  const occupancyRate = overview.occupancyRate;
  const occupancyColor =
    occupancyRate === null
      ? ""
      : occupancyRate >= 80
        ? "text-[var(--status-success-fg)]"
        : occupancyRate >= 50
          ? "text-[var(--status-warning-fg)]"
          : "text-[var(--status-danger-fg)]";
  const occupancyBorder =
    occupancyRate === null
      ? ""
      : occupancyRate >= 80
        ? "border-l-[var(--status-success-fg)]"
        : occupancyRate >= 50
          ? "border-l-[var(--status-warning-fg)]"
          : "border-l-[var(--status-danger-fg)]";

  const taskColor =
    overview.openTaskCount > 0 ? "text-[var(--status-warning-fg)]" : "";
  const taskBorder =
    overview.openTaskCount > 0 ? "border-l-[var(--status-warning-fg)]" : "";

  const collectionColor =
    overview.overdueCollectionCount > 0
      ? "text-[var(--status-danger-fg)]"
      : overview.openCollectionCount > 0
        ? "text-[var(--status-warning-fg)]"
        : "";
  const collectionBorder =
    overview.overdueCollectionCount > 0
      ? "border-l-[var(--status-danger-fg)]"
      : overview.openCollectionCount > 0
        ? "border-l-[var(--status-warning-fg)]"
        : "";

  const collectionRateColor =
    overview.collectionRate !== null
      ? overview.collectionRate >= 80
        ? "text-[var(--status-success-fg)]"
        : overview.collectionRate >= 50
          ? "text-[var(--status-warning-fg)]"
          : "text-[var(--status-danger-fg)]"
      : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Card
        className={cn(
          "border-border/80 bg-card/95 border-l-3",
          occupancyBorder || "border-l-transparent"
        )}
      >
        <CardContent className="p-4">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Occupancy" : "Ocupacion"}
          </p>
          <p className={cn("font-semibold text-2xl", occupancyColor)}>
            {occupancyRate !== null ? `${occupancyRate}%` : "-"}
          </p>
          {overview.vacantUnitCount > 0 ? (
            <p className="mt-0.5 text-muted-foreground text-xs">
              {overview.vacantUnitCount}{" "}
              {isEn ? "vacant" : "vacantes"}{" "}
              &middot; ~{formatCompactCurrency(overview.vacancyCostPyg, "PYG", locale)}
              {isEn ? "/mo lost" : "/mes perdido"}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-4">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Projected rent" : "Renta proyectada"}
          </p>
          <p className="font-semibold text-xl">
            {formatCurrency(overview.projectedRentPyg, "PYG", locale)}
          </p>
          {overview.collectionRate !== null ? (
            <p className={cn("mt-0.5 text-xs font-medium", collectionRateColor)}>
              {overview.collectionRate}%{" "}
              {isEn ? "collected" : "cobrado"}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card className="border-border/80 bg-card/95">
        <CardContent className="p-4">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Active leases" : "Contratos activos"}
          </p>
          <p className="font-semibold text-2xl">{overview.activeLeaseCount}</p>
          {overview.activeReservationCount > 0 ? (
            <p className="mt-0.5 text-muted-foreground text-xs">
              +{overview.activeReservationCount}{" "}
              {isEn ? "reservations" : "reservas"}
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card
        className={cn(
          "border-border/80 bg-card/95 border-l-3",
          taskBorder || "border-l-transparent"
        )}
      >
        <CardContent className="p-4">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Open tasks" : "Tareas abiertas"}
          </p>
          <p className={cn("font-semibold text-2xl", taskColor)}>
            {overview.openTaskCount}
          </p>
        </CardContent>
      </Card>
      <Card
        className={cn(
          "border-border/80 bg-card/95 border-l-3",
          collectionBorder || "border-l-transparent"
        )}
      >
        <CardContent className="p-4">
          <p className="text-muted-foreground text-xs">
            {isEn ? "Open collections" : "Cobros abiertos"}
          </p>
          <p className={cn("font-semibold text-2xl", collectionColor)}>
            {overview.openCollectionCount}
          </p>
          {overview.overdueCollectionCount > 0 ? (
            <p className="mt-0.5 text-xs font-medium text-[var(--status-danger-fg)]">
              {overview.overdueCollectionCount}{" "}
              {isEn ? "overdue" : "vencidos"}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
