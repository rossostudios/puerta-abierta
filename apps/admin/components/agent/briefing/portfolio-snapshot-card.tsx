"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import {
  CARD,
  EASING,
  fmtPyg,
  SectionLabel,
  type Stats,
  TrendBadge,
} from "./helpers";

export function PortfolioSnapshotCard({
  stats,
  isEn,
}: {
  stats: Stats;
  isEn: boolean;
}) {
  const revenueMtd = stats.revenue_mtd ?? 0;
  const prevRevenue = stats.prev_month_revenue;
  const occupancy = stats.blended_occupancy ?? 0;
  const occupiedUnits = stats.occupied_units ?? 0;
  const totalUnits = stats.total_units ?? 0;
  const openTickets = stats.open_tickets ?? 0;
  const aiActions = stats.approvals_24h?.total ?? 0;
  const propertyRevenue = stats.property_revenue ?? [];

  const maxRevenue = Math.max(...propertyRevenue.map((p) => p.revenue), 1);
  const avgRevenue =
    propertyRevenue.length > 0
      ? propertyRevenue.reduce((s, p) => s + p.revenue, 0) /
        propertyRevenue.length
      : 0;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className={cn(CARD, "space-y-5 p-5")}
      initial={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.4, ease: EASING }}
    >
      <SectionLabel>
        {isEn ? "Portfolio Snapshot" : "Resumen del Portafolio"}
      </SectionLabel>

      {/* Top metrics row — 4 columns */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <div className="flex items-baseline">
            <p className="font-bold text-xl tabular-nums leading-none">
              {revenueMtd > 0 ? fmtPyg(revenueMtd) : "—"}
            </p>
            {prevRevenue !== undefined && revenueMtd > 0 && (
              <TrendBadge current={revenueMtd} previous={prevRevenue} />
            )}
          </div>
          <p className="mt-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {isEn ? "Revenue MTD" : "Ingresos MTD"}
          </p>
        </div>
        <div>
          <p className="font-bold text-xl tabular-nums leading-none">
            {occupancy}%
          </p>
          <p className="mt-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {occupiedUnits}/{totalUnits} {isEn ? "UNITS" : "UNIDADES"}
          </p>
        </div>
        <div>
          <p className="font-bold text-xl tabular-nums leading-none">
            {openTickets}
          </p>
          <p className="mt-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {isEn ? "OPEN TICKETS" : "TICKETS ABIERTOS"}
          </p>
        </div>
        <div>
          <p className="font-bold text-xl tabular-nums leading-none">
            {aiActions}
          </p>
          <p className="mt-1.5 font-medium text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            {isEn ? "AI ACTIONS (24H)" : "ACCIONES IA (24H)"}
          </p>
        </div>
      </div>

      {/* Per-property revenue bars */}
      {propertyRevenue.length > 0 && (
        <div className="space-y-2.5">
          {propertyRevenue.map((prop, i) => {
            const barWidth = Math.max((prop.revenue / maxRevenue) * 100, 2);
            const propOccupancy = prop.occupancy ?? 0;
            const underperforming =
              (propOccupancy < 80 || prop.revenue < avgRevenue) &&
              prop.revenue > 0;

            return (
              <motion.div
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-3"
                initial={{ opacity: 0, x: -8 }}
                key={prop.name}
                transition={{
                  delay: 0.1 + i * 0.06,
                  duration: 0.3,
                  ease: EASING,
                }}
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                  {prop.name}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 font-medium text-[10px] uppercase",
                    prop.type === "ltr"
                      ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400"
                  )}
                >
                  {prop.type === "ltr" ? "LTR" : "STR"}
                </span>
                <div className="w-20 shrink-0 sm:w-28">
                  <div className="h-2 w-full rounded-full bg-muted/40">
                    <motion.div
                      animate={{ width: `${barWidth}%` }}
                      className={cn(
                        "h-full rounded-full",
                        underperforming
                          ? "bg-destructive"
                          : prop.type === "ltr"
                            ? "bg-emerald-500 dark:bg-emerald-400"
                            : "bg-amber-500 dark:bg-amber-400"
                      )}
                      initial={{ width: 0 }}
                      transition={{
                        delay: 0.2 + i * 0.06,
                        duration: 0.5,
                        ease: EASING,
                      }}
                    />
                  </div>
                </div>
                <span className="w-10 shrink-0 text-right text-[11px] text-muted-foreground/60 tabular-nums">
                  {propOccupancy}%
                </span>
                <span className="w-16 shrink-0 text-right font-medium text-foreground/70 text-xs tabular-nums">
                  {fmtPyg(prop.revenue)}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
