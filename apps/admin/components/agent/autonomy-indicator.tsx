"use client";

import type { AutonomyLevel } from "@/lib/agents/autonomy-level";
import { cn } from "@/lib/utils";

type AutonomyIndicatorProps = {
  level: AutonomyLevel;
  isEn: boolean;
};

const LEVEL_CONFIG: Record<
  AutonomyLevel,
  {
    bg: string;
    text: string;
    dot: string;
    labelEn: string;
    labelEs: string;
    tooltipEn: string;
    tooltipEs: string;
  }
> = {
  copilot: {
    bg: "bg-blue-500/10 border-blue-500/30",
    text: "text-blue-700 dark:text-blue-400",
    dot: "bg-blue-500",
    labelEn: "Copilot",
    labelEs: "Copiloto",
    tooltipEn: "All mutations require your approval before execution",
    tooltipEs:
      "Todas las mutaciones requieren tu aprobación antes de ejecutarse",
  },
  collaborator: {
    bg: "bg-amber-500/10 border-amber-500/30",
    text: "text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    labelEn: "Collaborator",
    labelEs: "Colaborador",
    tooltipEn: "Some actions run automatically, others require approval",
    tooltipEs:
      "Algunas acciones se ejecutan automáticamente, otras requieren aprobación",
  },
  autonomous: {
    bg: "bg-emerald-500/10 border-emerald-500/30",
    text: "text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    labelEn: "Autonomous",
    labelEs: "Autónomo",
    tooltipEn: "Most actions are auto-approved and executed immediately",
    tooltipEs:
      "La mayoría de las acciones se aprueban y ejecutan automáticamente",
  },
};

export function AutonomyIndicator({ level, isEn }: AutonomyIndicatorProps) {
  const config = LEVEL_CONFIG[level];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
        config.bg,
        config.text
      )}
      title={isEn ? config.tooltipEn : config.tooltipEs}
    >
      <span
        className={cn("inline-block h-1.5 w-1.5 rounded-full", config.dot)}
      />
      <span className="font-medium text-[10px]">
        {isEn ? config.labelEn : config.labelEs}
      </span>
    </div>
  );
}
