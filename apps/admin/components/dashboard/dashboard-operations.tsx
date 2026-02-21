"use client";

import {
  CalendarCheckIn01Icon,
  Home01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import { StatCard } from "@/components/ui/stat-card";

import type { OperationsKpis } from "./dashboard-utils";

type DashboardOperationsProps = {
  isEn: boolean;
  propertiesCount: number;
  operationsKpis: OperationsKpis;
};

export function DashboardOperations({
  isEn,
  propertiesCount,
  operationsKpis,
}: DashboardOperationsProps) {
  return (
    <section
      aria-label={isEn ? "Operations" : "Operaciones"}
      className="glass-surface rounded-3xl p-4 sm:p-5"
    >
      <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
        {isEn ? "Operations" : "Operaciones"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          helper={isEn ? "Listed so far" : "Registradas hasta ahora"}
          icon={Home01Icon}
          label={isEn ? "Properties" : "Propiedades"}
          value={String(propertiesCount)}
        />
        <StatCard
          helper={isEn ? "Check-ins next 7 days" : "Check-ins próximos 7 días"}
          icon={CalendarCheckIn01Icon}
          label={isEn ? "Upcoming check-ins" : "Check-ins próximos"}
          value={String(operationsKpis.upcomingCheckIns)}
        />
        <StatCard
          helper={`${isEn ? "Overdue" : "Vencidas"} ${operationsKpis.overdueTasks} · ${isEn ? "SLA" : "SLA"} ${operationsKpis.slaBreachedTasks}`}
          icon={Task01Icon}
          label={isEn ? "Open tasks" : "Tareas abiertas"}
          value={String(operationsKpis.openTasks)}
        />
      </div>
    </section>
  );
}
