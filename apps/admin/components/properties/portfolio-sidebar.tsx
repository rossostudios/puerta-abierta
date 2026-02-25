"use client";

import {
  AlertCircleIcon,
  Home01Icon,
  InformationCircleIcon,
  Invoice03Icon,
  Task01Icon,
  Time02Icon,
} from "@hugeicons/core-free-icons";
import { Icon } from "@/components/ui/icon";
import type {
  PropertyActivityItem,
  PropertyNotificationItem,
} from "@/lib/features/properties/types";
import { formatCompactCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

import { AgentActivityFeed } from "@/app/(admin)/module/properties/components/agent-activity-feed";

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
  orgId?: string;
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

function occupancyColor(rate: number): string {
  if (rate >= 90) return "text-[var(--status-success-fg)]";
  if (rate >= 70) return "text-[var(--status-warning-fg)]";
  return "text-[var(--status-danger-fg)]";
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
  orgId,
}: PortfolioStatsProps) {
  const hasAlerts = totalOverdueCollections > 0 || totalVacantUnits > 0;

  return (
    <div className="space-y-6">
      {/* Portfolio Value Header */}
      <div className="space-y-1 px-1">
        <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
          {isEn ? "Portfolio Summary" : "Resumen del Portafolio"}
        </h3>
        <div className="font-bold text-3xl tracking-tight text-foreground">
          {formatCompactCurrency(totalValuePyg, "PYG", formatLocale)}
        </div>
        <div className="text-xs text-muted-foreground/70">
          {isEn ? "Total asset value" : "Valor total de activos"}
        </div>
      </div>

      <div className="h-px bg-border/40" />

      {/* Key Metrics Row */}
      <div className="grid grid-cols-3 gap-3 px-1">
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Revenue MTD" : "Ingresos Mes"}
          </div>
          <div className="mt-0.5 font-semibold text-sm text-foreground">
            {formatCompactCurrency(totalRevenueMtdPyg, "PYG", formatLocale)}
          </div>
        </div>
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Occupancy" : "Ocupación"}
          </div>
          <div className={cn("mt-0.5 font-semibold text-sm", occupancyColor(occupancyRate))}>
            {Math.round(occupancyRate)}%
          </div>
        </div>
        <div>
          <div className="font-bold text-[10px] text-muted-foreground/70 uppercase tracking-wider">
            {isEn ? "Avg. Rent" : "Alq. Prom."}
          </div>
          <div className="mt-0.5 font-semibold text-sm text-foreground">
            {formatCompactCurrency(avgRentPyg, "PYG", formatLocale)}
          </div>
        </div>
      </div>

      {hasAlerts && (
        <>
          <div className="h-px bg-border/40" />

          {/* Attention Alerts */}
          <div className="space-y-2 px-1">
            <h3 className="font-bold text-[11px] text-muted-foreground/70 uppercase tracking-widest">
              {isEn ? "Attention" : "Atención"}
            </h3>

            {totalOverdueCollections > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg status-tone-danger border p-2.5 transition-colors hover:brightness-95">
                <Icon
                  icon={Invoice03Icon}
                  size={15}
                />
                <div className="min-w-0 flex-1 text-xs font-medium">
                  {totalOverdueCollections}{" "}
                  {isEn ? "overdue collections" : "cobros vencidos"}
                </div>
              </div>
            )}

            {totalVacantUnits > 0 && (
              <div className="flex items-center gap-2.5 rounded-lg status-tone-warning border p-2.5 transition-colors hover:brightness-95">
                <Icon
                  icon={Home01Icon}
                  size={15}
                />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium">
                    {totalVacantUnits} {isEn ? "vacant units" : "unidades vacantes"}
                  </span>
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    ~{formatCompactCurrency(vacancyCostPyg, "PYG", formatLocale)}{" "}
                    {isEn ? "/mo" : "/mes"}
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Action Required Notifications */}
      {notifications.length > 0 && (
        <>
          <div className="h-px bg-border/40" />

          <div className="space-y-2 px-1">
            <h3 className="font-bold text-[11px] text-[var(--status-danger-fg)]/80 uppercase tracking-widest">
              {isEn ? "Action Required" : "Acción Requerida"}
            </h3>
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div
                  className={cn(
                    "flex gap-2.5 rounded-lg border p-2.5 transition-colors hover:brightness-95",
                    `status-tone-${notification.tone ?? "danger"}`
                  )}
                  key={notification.id}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                    <Icon icon={AlertCircleIcon} size={14} />
                  </div>
                  <div className="min-w-0 space-y-0.5">
                    <h4 className="font-semibold text-xs leading-tight">
                      {notification.title}
                    </h4>
                    <p className="text-[11px] leading-snug opacity-80">
                      {notification.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Recent Activity */}
      <div className="space-y-3">
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

        <div className="space-y-3 px-1">
          {recentActivity.length === 0 ? (
            <div className="py-2 text-muted-foreground text-xs italic">
              {isEn
                ? "No recent activity recorded."
                : "No se registró actividad reciente."}
            </div>
          ) : (
            recentActivity.map((item) => (
              <div className="group flex gap-3" key={item.id}>
                <div
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-transform group-hover:scale-105",
                    item.tone === "info" && "status-tone-info border",
                    item.tone === "warning" && "status-tone-warning border",
                    item.tone === "danger" && "status-tone-danger border",
                    item.tone === "success" && "status-tone-success border"
                  )}
                >
                  <Icon icon={activityIcon(item)} size={14} />
                </div>
                <div className="space-y-0.5">
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

        {recentActivity.length > 0 && (
          <div className="px-1 pt-1">
            <button
              className="font-bold text-[11px] text-primary transition-all hover:underline"
              type="button"
            >
              {isEn ? "View all activity" : "Ver toda la actividad"}
            </button>
          </div>
        )}
      </div>

      {orgId && <AgentActivityFeed isEn={isEn} orgId={orgId} />}
    </div>
  );
}
