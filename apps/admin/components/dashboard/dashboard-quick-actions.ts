import {
  CalendarCheckIn01Icon,
  ChartIcon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";

import type { DashboardRole, QuickAction } from "./dashboard-utils";

export function roleQuickActions(role: DashboardRole): QuickAction[] {
  if (role === "operator") {
    return [
      {
        href: "/module/operations?tab=tasks",
        labelEn: "Plan today",
        labelEs: "Planificar hoy",
        detailEn: "Create and assign high-priority tasks.",
        detailEs: "Crea y asigna tareas de prioridad alta.",
        icon: Task01Icon,
      },
      {
        href: "/module/reservations",
        labelEn: "Check arrivals",
        labelEs: "Ver llegadas",
        detailEn: "Review check-ins and check-outs for this week.",
        detailEs: "Revisa check-ins y check-outs de la semana.",
        icon: CalendarCheckIn01Icon,
      },
      {
        href: "/module/applications",
        labelEn: "Review applications",
        labelEs: "Revisar aplicaciones",
        detailEn: "Process new applicants and next actions.",
        detailEs: "Procesa postulantes y siguientes acciones.",
        icon: File01Icon,
      },
    ];
  }

  if (role === "owner_admin") {
    return [
      {
        href: "/module/owner-statements",
        labelEn: "Payout statements",
        labelEs: "Liquidaciones",
        detailEn: "View monthly payout statements.",
        detailEs: "Revisa liquidaciones mensuales.",
        icon: Invoice01Icon,
      },
      {
        href: "/module/collections",
        labelEn: "Payments",
        labelEs: "Pagos",
        detailEn: "Monitor received, pending, and overdue payments.",
        detailEs: "Monitorea pagos recibidos, pendientes y vencidos.",
        icon: ChartIcon,
      },
      {
        href: "/module/listings",
        labelEn: "Review listings",
        labelEs: "Revisar anuncios",
        detailEn: "Publish complete listings with transparent pricing.",
        detailEs: "Publica anuncios completos con precios transparentes.",
        icon: Home01Icon,
      },
    ];
  }

  if (role === "accountant") {
    return [
      {
        href: "/module/expenses",
        labelEn: "Record expenses",
        labelEs: "Registrar gastos",
        detailEn: "Capture operating costs for this period.",
        detailEs: "Registra costos operativos del periodo.",
        icon: Invoice01Icon,
      },
      {
        href: "/module/owner-statements",
        labelEn: "Reconcile payouts",
        labelEs: "Conciliar liquidaciones",
        detailEn: "Match lease and collection records.",
        detailEs: "Verifica consistencia de contratos y cobros.",
        icon: File01Icon,
      },
      {
        href: "/module/reports",
        labelEn: "Reporting hub",
        labelEs: "Centro de reportes",
        detailEn: "Export financial and operations summaries.",
        detailEs: "Exporta resumenes financieros y operativos.",
        icon: ChartIcon,
      },
    ];
  }

  return [
    {
      href: "/module/reports",
      labelEn: "Portfolio performance",
      labelEs: "Rendimiento del portafolio",
      detailEn: "Review revenue, occupancy, and net payout.",
      detailEs: "Revisa ingresos, ocupacion y pago neto.",
      icon: ChartIcon,
    },
    {
      href: "/module/reservations",
      labelEn: "Upcoming stays",
      labelEs: "Proximas estadias",
      detailEn: "Track upcoming check-ins and check-outs.",
      detailEs: "Sigue check-ins y check-outs proximos.",
      icon: CalendarCheckIn01Icon,
    },
    {
      href: "/module/operations?tab=tasks",
      labelEn: "Operations risks",
      labelEs: "Riesgos operativos",
      detailEn: "See overdue tasks and SLA risk signals.",
      detailEs: "Visualiza tareas vencidas y senales de riesgo SLA.",
      icon: Task01Icon,
    },
  ];
}
