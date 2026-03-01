"use client";

import { motion } from "motion/react";
import { EASING } from "@/lib/module-helpers";
import { cn } from "@/lib/utils";
import type { OperationsSummary } from "../hooks/use-operations-portfolio";

type OperationsMetricsBarProps = {
  summary: OperationsSummary;
  isEn: boolean;
};

export function OperationsMetricsBar({
  summary,
  isEn,
}: OperationsMetricsBarProps) {
  const metrics = [
    {
      label: isEn ? "Open Tasks" : "Tareas abiertas",
      value: `${summary.openTaskCount}`,
      tone:
        summary.overdueTaskCount > 0
          ? ("danger" as const)
          : summary.openTaskCount > 0
            ? ("warning" as const)
            : ("default" as const),
    },
    {
      label: isEn ? "Maintenance" : "Mantenimiento",
      value: `${summary.maintenanceCount}`,
      tone:
        summary.emergencyCount > 0
          ? ("danger" as const)
          : summary.maintenanceCount > 0
            ? ("warning" as const)
            : ("default" as const),
    },
    {
      label: isEn ? "Completion Rate" : "Tasa de completado",
      value: `${summary.completionRate}%`,
      tone:
        summary.completionRate >= 80
          ? ("success" as const)
          : summary.completionRate >= 50
            ? ("warning" as const)
            : ("danger" as const),
    },
    {
      label: isEn ? "SLA Compliance" : "Cumplimiento SLA",
      value: `${summary.slaCompliance}%`,
      tone:
        summary.slaCompliance >= 90
          ? ("success" as const)
          : summary.slaCompliance >= 70
            ? ("warning" as const)
            : ("danger" as const),
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
