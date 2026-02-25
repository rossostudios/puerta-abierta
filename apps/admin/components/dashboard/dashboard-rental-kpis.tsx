"use client";

import {
  CalendarCheckIn01Icon,
  ChartIcon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import { StatCard } from "@/components/ui/stat-card";
import type { KpiDashboard } from "@/lib/api";
import { formatCurrency } from "@/lib/format";

import { numberOrZero } from "./dashboard-utils";

type DashboardFinancialKpisProps = {
  isEn: boolean;
  locale: string;
  kpiDashboard: KpiDashboard;
  grossRevenue: number;
  expenses: number;
  netPayout: number;
};

type DashboardOperationalPlanningKpisProps = {
  isEn: boolean;
  kpiDashboard: KpiDashboard;
};

export function DashboardFinancialKpis({
  isEn,
  locale,
  kpiDashboard,
  grossRevenue,
  expenses,
  netPayout,
}: DashboardFinancialKpisProps) {
  return (
    <section
      aria-label={isEn ? "Financial pulse" : "Pulso financiero"}
      className="glass-surface rounded-3xl p-4 sm:p-5"
    >
      <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
        {isEn ? "Financial pulse" : "Pulso financiero"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          helper={
            isEn
              ? `${numberOrZero(kpiDashboard.paid_collections)}/${numberOrZero(kpiDashboard.total_collections)} payments received`
              : `${numberOrZero(kpiDashboard.paid_collections)}/${numberOrZero(kpiDashboard.total_collections)} pagos recibidos`
          }
          icon={Invoice01Icon}
          label={isEn ? "Payment rate" : "Tasa de pago"}
          value={`${(numberOrZero(kpiDashboard.collection_rate) * 100).toFixed(1)}%`}
        />
        <StatCard
          helper={isEn ? "Among late payments" : "Entre pagos atrasados"}
          icon={CalendarCheckIn01Icon}
          label={isEn ? "Avg days late" : "Promedio dias de atraso"}
          value={`${numberOrZero(kpiDashboard.avg_days_late).toFixed(1)}d`}
        />
        <StatCard
          helper={isEn ? "After expenses" : "Después de gastos"}
          icon={File01Icon}
          label={isEn ? "Net payout" : "Pago neto"}
          value={formatCurrency(netPayout, "PYG", locale)}
        />
        <StatCard
          helper={isEn ? "Current month gross" : "Bruto del mes"}
          icon={ChartIcon}
          label={isEn ? "Gross revenue" : "Ingresos brutos"}
          value={formatCurrency(grossRevenue, "PYG", locale)}
        />
        <StatCard
          helper={isEn ? "Current month" : "Mes actual"}
          icon={Invoice01Icon}
          label={isEn ? "Expenses" : "Gastos"}
          value={formatCurrency(expenses, "PYG", locale)}
        />
        <StatCard
          helper={
            isEn
              ? `${numberOrZero(kpiDashboard.total_units)} units`
              : `${numberOrZero(kpiDashboard.total_units)} unidades`
          }
          icon={Home01Icon}
          label={isEn ? "Revenue per unit" : "Ingreso por unidad"}
          value={formatCurrency(
            numberOrZero(kpiDashboard.revenue_per_unit),
            "PYG",
            locale
          )}
        />
      </div>
    </section>
  );
}

export function DashboardOperationalPlanningKpis({
  isEn,
  kpiDashboard,
}: DashboardOperationalPlanningKpisProps) {
  return (
    <section
      aria-label={isEn ? "Occupancy planning" : "Planificación de ocupación"}
      className="glass-surface rounded-3xl p-4 sm:p-5"
    >
      <h2 className="mb-3 font-medium text-[11px] text-muted-foreground uppercase tracking-[0.14em]">
        {isEn ? "Occupancy planning" : "Planificación de ocupación"}
      </h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <StatCard
          helper={
            isEn
              ? `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} occupied`
              : `${numberOrZero(kpiDashboard.active_leases)}/${numberOrZero(kpiDashboard.total_units)} ocupadas`
          }
          icon={Home01Icon}
          label={isEn ? "Occupancy rate" : "Tasa de ocupacion"}
          value={`${(numberOrZero(kpiDashboard.occupancy_rate) * 100).toFixed(1)}%`}
        />
        <StatCard
          helper={isEn ? "Next 60 days" : "Próximos 60 días"}
          icon={File01Icon}
          label={isEn ? "Expiring leases" : "Contratos por vencer"}
          value={String(numberOrZero(kpiDashboard.expiring_leases_60d))}
        />
        <StatCard
          helper={
            kpiDashboard.avg_maintenance_response_hours != null
              ? isEn
                ? `Median: ${numberOrZero(kpiDashboard.median_maintenance_response_hours).toFixed(0)}h`
                : `Mediana: ${numberOrZero(kpiDashboard.median_maintenance_response_hours).toFixed(0)}h`
              : isEn
                ? "No data yet"
                : "Sin datos aun"
          }
          icon={Task01Icon}
          label={isEn ? "Maintenance response" : "Respuesta mantenimiento"}
          value={
            kpiDashboard.avg_maintenance_response_hours != null
              ? `${numberOrZero(kpiDashboard.avg_maintenance_response_hours).toFixed(0)}h`
              : "--"
          }
        />
      </div>
    </section>
  );
}
