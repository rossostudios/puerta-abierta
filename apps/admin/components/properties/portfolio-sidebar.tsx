"use client";

import {
  AlertCircleIcon,
  ChartIcon,
  Home01Icon,
  InformationCircleIcon,
  Invoice03Icon,
  Task01Icon,
  Time02Icon,
} from "@hugeicons/core-free-icons";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type {
  PropertyActivityItem,
  PropertyNotificationItem,
} from "@/lib/features/properties/types";
import { formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

type PortfolioStatsProps = {
  totalValuePyg: number;
  occupancyRate: number;
  avgRentPyg: number;
  totalRevenueMtdPyg: number;
  totalOverdueCollections: number;
  totalVacantUnits: number;
  vacancyCostPyg: number;
  recentActivity: PropertyActivityItem[];
  notifications: PropertyNotificationItem[];
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
};

function relativeTimeLabel(timestamp: Date, isEn: boolean): string {
  const deltaMs = Date.now() - timestamp.getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / (1000 * 60)));

  if (minutes < 60) {
    return isEn ? `${minutes}m ago` : `${minutes}m atrás`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return isEn ? `${hours}h ago` : `hace ${hours}h`;
  }

  const days = Math.floor(hours / 24);
  return isEn ? `${days}d ago` : `hace ${days}d`;
}

function activityIcon(item: PropertyActivityItem) {
  if (item.id.startsWith("task")) return Task01Icon;
  if (item.id.startsWith("collection")) return Invoice03Icon;
  if (item.title.toLowerCase().includes("lease")) return Home01Icon;
  return InformationCircleIcon;
}

export function PortfolioSidebar({
  totalValuePyg,
  occupancyRate,
  avgRentPyg,
  totalRevenueMtdPyg,
  totalOverdueCollections,
  totalVacantUnits,
  vacancyCostPyg,
  recentActivity,
  notifications,
  isEn,
  formatLocale,
}: PortfolioStatsProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h3 className="px-1 font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
          {isEn ? "Portfolio Summary" : "Resumen del Portafolio"}
        </h3>

        <Card className="group relative overflow-hidden border-0 bg-casaora-gradient text-white shadow-casaora">
          <div className="absolute top-0 right-0 p-4 opacity-5 transition-transform group-hover:translate-x-2 group-hover:-translate-y-2">
            <Icon icon={ChartIcon} size={140} />
          </div>
          <CardContent className="relative z-10 space-y-4 p-5">
            <div>
              <div className="font-semibold text-[11px] text-white/70 uppercase tracking-wider">
                {isEn ? "Total Assets" : "Activos Totales"}
              </div>
              <div className="mt-1 font-bold text-3xl text-white tracking-tight">
                {formatCompactCurrency(totalValuePyg, "PYG", formatLocale)}
              </div>
            </div>
            <div className="rounded-lg bg-white/10 px-3 py-2">
              <div className="font-medium text-[10px] text-white/60 uppercase tracking-wider">
                {isEn ? "Revenue MTD" : "Ingresos del Mes"}
              </div>
              <div className="mt-0.5 font-bold text-lg text-white/90">
                {formatCompactCurrency(totalRevenueMtdPyg, "PYG", formatLocale)}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <Card className="transition-colors">
            <CardContent className="space-y-1 p-3">
              <div className="font-bold text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {isEn ? "Occupancy" : "Ocupación"}
              </div>
              <div className="font-bold text-[var(--status-success-fg)] text-lg">
                {Math.round(occupancyRate)}%
              </div>
            </CardContent>
          </Card>
          <Card className="transition-colors">
            <CardContent className="space-y-1 p-3">
              <div className="font-bold text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {isEn ? "Avg. Rent" : "Alquiler Prom."}
              </div>
              <div className="font-bold text-foreground text-lg">
                {formatCompactCurrency(avgRentPyg, "PYG", formatLocale)}
              </div>
            </CardContent>
          </Card>
        </div>

        {totalOverdueCollections > 0 ? (
          <Card className="border-[var(--status-danger-border)] bg-[var(--status-danger-bg)] shadow-sm">
            <CardContent className="flex items-center gap-3 p-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--status-danger-fg)]/10">
                <Icon
                  className="text-[var(--status-danger-fg)]"
                  icon={Invoice03Icon}
                  size={18}
                />
              </div>
              <div>
                <div className="font-bold text-[10px] text-[var(--status-danger-fg)] uppercase tracking-wider">
                  {isEn ? "Overdue Collections" : "Cobros Vencidos"}
                </div>
                <div className="font-bold text-[var(--status-danger-fg)] text-lg">
                  {totalOverdueCollections}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {totalVacantUnits > 0 ? (
          <Card>
            <CardContent className="space-y-1 p-3">
              <div className="font-bold text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                {isEn ? "Vacancy Cost" : "Costo de Vacancia"}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-bold text-[var(--status-warning-fg)] text-lg">
                  {totalVacantUnits} {isEn ? "units" : "unidades"}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                ~{formatCompactCurrency(vacancyCostPyg, "PYG", formatLocale)}{" "}
                {isEn ? "potential lost /mo" : "pérdida potencial /mes"}
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      {notifications.length > 0 ? (
        <div className="space-y-3">
          <h3 className="px-1 font-bold text-[11px] text-red-500/80 uppercase tracking-widest">
            {isEn ? "Action Required" : "Acción Requerida"}
          </h3>
          <div className="space-y-2">
            {notifications.map((notification) => (
              <div
                className="flex gap-3 rounded-xl border border-red-100 bg-red-50/30 p-3 dark:border-red-900/20 dark:bg-red-950/20"
                key={notification.id}
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400">
                  <Icon icon={AlertCircleIcon} size={16} />
                </div>
                <div className="space-y-0.5">
                  <h4 className="font-semibold text-red-900 text-sm dark:text-red-200">
                    {notification.title}
                  </h4>
                  <p className="text-red-700/80 text-xs leading-relaxed dark:text-red-400/80">
                    {notification.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
            {isEn ? "Recent Activity" : "Actividad Reciente"}
          </h3>
          <Icon
            className="text-muted-foreground/50"
            icon={Time02Icon}
            size={14}
          />
        </div>

        <div className="space-y-5 px-1">
          {recentActivity.length === 0 ? (
            <div className="py-2 text-muted-foreground text-xs italic">
              {isEn
                ? "No recent activity recorded."
                : "No se registró actividad reciente."}
            </div>
          ) : (
            recentActivity.map((item) => (
              <div className="group flex gap-4" key={item.id}>
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105",
                    item.tone === "info" && "status-tone-info border",
                    item.tone === "warning" && "status-tone-warning border",
                    item.tone === "danger" && "status-tone-danger border",
                    item.tone === "success" && "status-tone-success border"
                  )}
                >
                  <Icon icon={activityIcon(item)} size={16} />
                </div>
                <div className="space-y-1">
                  <div className="font-semibold text-foreground text-sm leading-tight">
                    {item.title}
                  </div>
                  <div className="text-muted-foreground text-xs leading-snug">
                    {item.detail}
                  </div>
                  <div className="pt-0.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-tight">
                    {relativeTimeLabel(item.timestamp, isEn)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {recentActivity.length > 0 ? (
          <div className="px-1 pt-2">
            <button
              className="font-bold text-[11px] text-primary transition-all hover:underline"
              type="button"
            >
              {isEn ? "View all activity" : "Ver toda la actividad"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
