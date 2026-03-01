"use client";

import { motion } from "motion/react";
import type { PropertyPortfolioSummary } from "@/lib/features/properties/types";
import { formatCompactCurrency } from "@/lib/format";
import { EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";

type PortfolioMetricsBarProps = {
  summary: PropertyPortfolioSummary;
  isEn: boolean;
  formatLocale: string;
};

export function PortfolioMetricsBar({
  summary,
  isEn,
  formatLocale,
}: PortfolioMetricsBarProps) {
  const occupancyPct = Math.round(summary.averageOccupancy);
  const attentionCount =
    summary.totalOpenTasks + summary.totalOverdueCollections;

  const metrics = [
    {
      label: isEn ? "Revenue MTD" : "Ingresos del mes",
      value: formatCompactCurrency(
        summary.totalRevenueMtdPyg,
        "PYG",
        formatLocale
      ).replace(/PYG\s?/, "₲"),
      tone: "default" as const,
    },
    {
      label: isEn ? "Avg Occupancy" : "Ocupación prom.",
      value: `${occupancyPct}%`,
      tone:
        occupancyPct >= 80
          ? ("success" as const)
          : occupancyPct >= 50
            ? ("warning" as const)
            : ("danger" as const),
    },
    {
      label: isEn ? "Units Occupied" : "Unidades ocupadas",
      value: `${summary.totalActiveLeases}/${summary.totalUnits}`,
      tone: "default" as const,
    },
    {
      label: isEn ? "Need Attention" : "Requieren atención",
      value: `${attentionCount}`,
      tone: attentionCount > 0 ? ("danger" as const) : ("default" as const),
    },
  ];

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      initial={{ opacity: 0, y: 8 }}
      transition={{ delay: 0.1, duration: 0.35, ease: EASING }}
    >
      {metrics.map((m, i) => (
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="glass-inner rounded-xl p-4"
          initial={{ opacity: 0, scale: 0.97 }}
          key={m.label}
          transition={{ delay: 0.15 + i * 0.05, duration: 0.3, ease: EASING }}
        >
          <p
            className={cn(
              "font-semibold text-xl tabular-nums tracking-tight",
              m.tone === "success" && "text-emerald-600 dark:text-emerald-400",
              m.tone === "warning" && "text-amber-600 dark:text-amber-400",
              m.tone === "danger" && "text-red-600 dark:text-red-400",
              m.tone === "default" && "text-foreground"
            )}
          >
            {m.value}
          </p>
          <p className="mt-1 text-muted-foreground/70 text-xs">{m.label}</p>
        </motion.div>
      ))}
    </motion.div>
  );
}
