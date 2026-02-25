import {
  ChartIcon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { Suspense, type ComponentProps } from "react";
import {
  isRentalMode,
  type RentalMode,
} from "@/app/(admin)/setup/setup-components";
import { AnomalyAlerts } from "@/components/dashboard/anomaly-alerts";
import {
  type CollectionHealthSnapshot,
  DashboardFinancialPanels,
  DashboardOperationsPanels,
} from "@/components/dashboard/dashboard-charts";
import {
  safeAuthUser,
  safeList,
  safeMe,
  safeOperationsSummary,
  safeReport,
} from "@/components/dashboard/dashboard-data";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardModuleCards } from "@/components/dashboard/dashboard-module-cards";
import { DashboardNeedsAttention } from "@/components/dashboard/dashboard-needs-attention";
import { DashboardOperations } from "@/components/dashboard/dashboard-operations";
import { DashboardQueryBar } from "@/components/dashboard/dashboard-query-bar";
import { PredictiveOutlook } from "@/components/dashboard/predictive-outlook";
import { roleQuickActions } from "@/components/dashboard/dashboard-quick-actions";
import {
  DashboardFinancialKpis,
  DashboardOperationalPlanningKpis,
} from "@/components/dashboard/dashboard-rental-kpis";
import { DashboardTabs } from "@/components/dashboard/dashboard-tabs";
import {
  countByStatus,
  type NeedsAttentionItem,
  normalizedRole,
  numberOrZero,
  roleGreeting,
  userDisplayName,
} from "@/components/dashboard/dashboard-utils";
import { GettingStartedChecklist } from "@/components/dashboard/getting-started-checklist";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableCard } from "@/components/ui/table-card";
import {
  fetchKpiDashboard,
  fetchList,
  fetchOccupancyForecast,
  fetchRevenueTrend,
  type KpiDashboard,
  type OccupancyForecastResponse,
  type OperationsSummary,
  type RevenueTrendResponse,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getChecklistItems } from "@/lib/onboarding-checklist";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

type DashboardPageProps = {
  searchParams: Promise<{ onboarding?: string }>;
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({
  searchParams,
}: DashboardPageProps) {
  const { onboarding } = await searchParams;
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const authUser = await safeAuthUser();
  const onboardingCompleted = onboarding === "completed";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to load portfolio data."
              : "Selecciona una organización para cargar los datos del portafolio."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Open{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>{" "}
              to create your first organization, or use the organization
              switcher in the top bar.
            </>
          ) : (
            <>
              Abre{" "}
              <code className="rounded bg-muted px-1 py-0.5">Onboarding</code>{" "}
              para crear tu primera organización, o usa el selector de
              organización en la barra superior.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let properties: unknown[] = [];
  let units: unknown[] = [];
  let reservations: unknown[] = [];
  let tasks: unknown[] = [];
  let applications: unknown[] = [];
  let collections: unknown[] = [];
  let listings: unknown[] = [];
  let integrations: unknown[] = [];
  let expenses: unknown[] = [];
  let leases: unknown[] = [];
  let summary: Record<string, unknown> = {};
  let operationsSummary: OperationsSummary = {};
  let kpiDashboard: KpiDashboard = {};
  let forecastData: OccupancyForecastResponse = {
    historical_avg_occupancy_pct: 0,
    total_units: 0,
    months: [],
  };
  let revenueTrendData: RevenueTrendResponse = { months: [] };
  let mePayload: Record<string, unknown> = {};
  let orgRentalMode: RentalMode = "both";
  let apiAvailable = true;
  try {
    await fetchList("/organizations", orgId, 1);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    apiAvailable = false;
  }

  if (apiAvailable) {
    try {
      const [
        props,
        unitRows,
        resas,
        taskRows,
        appRows,
        collectionRows,
        listingRows,
        integrationRows,
        expenseRows,
        leaseRows,
        summ,
        opsSummary,
        me,
        orgRows,
        kpiData,
        forecastResult,
        revenueTrendResult,
      ] = await Promise.all([
        safeList("/properties", orgId),
        safeList("/units", orgId),
        safeList("/reservations", orgId),
        safeList("/tasks", orgId),
        safeList("/applications", orgId),
        safeList("/collections", orgId),
        safeList("/listings", orgId),
        safeList("/integrations", orgId),
        safeList("/expenses", orgId),
        safeList("/leases", orgId),
        safeReport("/reports/summary", orgId),
        safeOperationsSummary(orgId),
        safeMe(),
        safeList("/organizations", orgId),
        fetchKpiDashboard(orgId).catch(() => ({}) as KpiDashboard),
        fetchOccupancyForecast(orgId).catch(
          () =>
            ({
              historical_avg_occupancy_pct: 0,
              total_units: 0,
              months: [],
            }) as OccupancyForecastResponse
        ),
        fetchRevenueTrend(orgId).catch(
          () => ({ months: [] }) as RevenueTrendResponse
        ),
      ] as const);

      properties = props;
      units = unitRows;
      reservations = resas;
      tasks = taskRows;
      applications = appRows;
      collections = collectionRows;
      listings = listingRows;
      integrations = integrationRows;
      expenses = expenseRows;
      leases = leaseRows;
      summary = summ;
      operationsSummary = opsSummary;
      mePayload = me;
      kpiDashboard = kpiData;
      forecastData = forecastResult;
      revenueTrendData = revenueTrendResult;

      const orgRecord = (orgRows as Record<string, unknown>[]).find(
        (row) => row.id === orgId
      );
      const rawRentalMode = orgRecord?.rental_mode;
      if (isRentalMode(rawRentalMode)) {
        orgRentalMode = rawRentalMode;
      }
    } catch {
      apiAvailable = false;
    }
  }

  const memberships = Array.isArray(mePayload.memberships)
    ? (mePayload.memberships as Record<string, unknown>[])
    : [];
  const activeMembership =
    memberships.find((membership) => membership.organization_id === orgId) ??
    null;
  const activeRole = normalizedRole(activeMembership?.role);
  const quickActions = roleQuickActions(activeRole);
  const greeting = roleGreeting(locale, isEn);
  const displayName = userDisplayName(mePayload, authUser);
  const greetingTitle = displayName ? `${greeting}, ${displayName}` : greeting;
  const grossRevenue = numberOrZero(summary.gross_revenue);
  const totalExpenses = numberOrZero(summary.expenses);
  const netPayout = numberOrZero(summary.net_payout);

  const occupancyRate =
    typeof summary.occupancy_rate === "number"
      ? `${(summary.occupancy_rate * 100).toFixed(1)}%`
      : kpiDashboard.occupancy_rate != null
        ? `${(numberOrZero(kpiDashboard.occupancy_rate) * 100).toFixed(1)}%`
        : "0%";

  const revenueSnapshot = apiAvailable
    ? {
        periodLabel: isEn ? "This month" : "Este mes",
        currency: "PYG",
        gross: grossRevenue,
        expenses: totalExpenses,
        net: netPayout,
      }
    : null;

  const taskStatuses = countByStatus(tasks as unknown[], [
    "todo",
    "in_progress",
    "done",
    "cancelled",
    "unknown",
  ]);

  const qualifiedLikeStatuses = new Set([
    "qualified",
    "visit_scheduled",
    "offer_sent",
    "contract_signed",
  ]);
  const qualifiedApplications = (
    applications as Record<string, unknown>[]
  ).filter((row) => qualifiedLikeStatuses.has(String(row.status ?? ""))).length;

  const pendingApplications = (
    applications as Record<string, unknown>[]
  ).filter(
    (row) => String(row.status ?? "").toLowerCase() === "pending"
  ).length;

  const paidCollections = (collections as Record<string, unknown>[]).filter(
    (row) => String(row.status ?? "") === "paid"
  ).length;
  const operationsKpis = {
    turnoversDue: numberOrZero(operationsSummary.turnovers_due),
    turnoversOnTime: numberOrZero(
      operationsSummary.turnovers_completed_on_time
    ),
    turnoverOnTimeRate: numberOrZero(operationsSummary.turnover_on_time_rate),
    openTasks: numberOrZero(operationsSummary.open_tasks),
    overdueTasks: numberOrZero(operationsSummary.overdue_tasks),
    slaBreachedTasks: numberOrZero(operationsSummary.sla_breached_tasks),
    upcomingCheckIns: numberOrZero(
      operationsSummary.reservations_upcoming_check_in
    ),
    upcomingCheckOuts: numberOrZero(
      operationsSummary.reservations_upcoming_check_out
    ),
  };

  const needsAttention = buildNeedsAttention(
    collections as Record<string, unknown>[],
    listings as Record<string, unknown>[],
    applications as Record<string, unknown>[],
    leases as Record<string, unknown>[],
    operationsKpis.slaBreachedTasks
  );

  const checklistItems = getChecklistItems(orgRentalMode, {
    properties: properties.length,
    units: units.length,
    channels: integrations.length,
    reservations: reservations.length,
    tasks: tasks.length,
    expenses: expenses.length,
    listings: listings.length,
    applications: applications.length,
    leases: leases.length,
    collections: collections.length,
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const sevenDaysAgoStr = new Date(Date.now() - 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const overdueCollectionsCount = (
    collections as Record<string, unknown>[]
  ).filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "paid" || status === "waived") return false;
    const dueDate = String(row.due_date ?? "");
    return dueDate < todayStr && ISO_DATE_REGEX.test(dueDate);
  }).length;

  const pendingCollectionsCount = (
    collections as Record<string, unknown>[]
  ).filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    return status === "pending" || status === "open";
  }).length;

  const draftListingsCount = (
    listings as Record<string, unknown>[]
  ).filter((row) => {
    if (row.is_published) return false;
    const created = String(row.created_at ?? "").slice(0, 10);
    if (!(created && ISO_DATE_REGEX.test(created))) return true;
    return created < sevenDaysAgoStr;
  }).length;

  const quickActionsWithCounts = quickActions.map((action) => ({
    ...action,
    count: inferQuickActionCount(action.href, {
      propertiesCount: properties.length,
      reservationsCount: reservations.length,
      pendingApplications,
      qualifiedApplications,
      expensesCount: expenses.length,
      openTasksCount: operationsKpis.openTasks,
      overdueTasksCount: operationsKpis.overdueTasks,
      upcomingStaysCount:
        operationsKpis.upcomingCheckIns + operationsKpis.upcomingCheckOuts,
      overdueCollectionsCount,
      draftListingsCount,
    }),
  }));

  const activeInquiryCount = (
    reservations as Record<string, unknown>[]
  ).filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    return status === "pending" || status === "confirmed";
  }).length;

  const occupancySeries = forecastData.months
    .map((month) => numberOrZero(month.occupancy_pct))
    .filter((value) => Number.isFinite(value));
  const revenueSeries = revenueTrendData.months
    .map((month) => numberOrZero(month.revenue))
    .filter((value) => Number.isFinite(value));
  const pipelineStatusCounts = countByStatus(applications as unknown[]);
  const pipelineStatusCountMap = new Map(
    pipelineStatusCounts.map((item) => [item.status.toLowerCase(), item.count])
  );

  const collectionRatePct =
    collections.length > 0 ? (paidCollections / collections.length) * 100 : 0;
  const collectionDeltaFromTarget = collectionRatePct - 95;
  const pipelineTotal = qualifiedApplications + pendingApplications;
  const collectionHealth: CollectionHealthSnapshot = {
    totalCollections: collections.length,
    paidCollections,
    pendingCollections: pendingCollectionsCount,
    overdueCollections: overdueCollectionsCount,
    collectionRatePct,
    avgDaysLate: numberOrZero(kpiDashboard.avg_days_late),
  };

  const overviewMetrics: DashboardOverviewMetric[] = [
    {
      key: "occupancy",
      href: "/module/leases",
      icon: Home01Icon,
      iconAccentClassName:
        "bg-[var(--sidebar-primary)]/10 text-[var(--sidebar-primary)] ring-[var(--sidebar-primary)]/15",
      label: isEn ? "Occupancy" : "Ocupación",
      value: occupancyRate,
      helper: isEn ? "Current period" : "Periodo actual",
      deltaLabel: formatSignedPercent(
        computeSeriesPercentChange(occupancySeries)
      ),
      deltaTone: "positive",
      bars: occupancySeries.slice(-6),
      barClassName: "bg-[var(--sidebar-primary)]/35",
      barActiveClassName: "bg-[var(--sidebar-primary)]/60",
    },
    {
      key: "revenue",
      href: "/module/reports/finance",
      icon: ChartIcon,
      iconAccentClassName:
        "bg-emerald-500/10 text-emerald-600 ring-emerald-500/15",
      label: isEn ? "Revenue" : "Ingresos",
      value: formatCompactCurrencyValue(
        numberOrZero(summary.gross_revenue),
        "PYG",
        locale
      ),
      helper: isEn ? "Monthly gross" : "Bruto mensual",
      deltaLabel: formatSignedPercent(computeSeriesPercentChange(revenueSeries)),
      deltaTone: "positive",
      bars: revenueSeries.slice(-6),
      barClassName: "bg-emerald-500/25",
      barActiveClassName: "bg-emerald-500/45",
    },
    {
      key: "collection",
      href: "/module/collections",
      icon: Invoice01Icon,
      iconAccentClassName: "bg-slate-500/10 text-slate-600 ring-slate-500/15",
      label: isEn ? "Payments" : "Pagos",
      value: `${collectionRatePct.toFixed(0)}%`,
      helper:
        collections.length > 0
          ? `${paidCollections}/${collections.length} ${isEn ? "payments received" : "pagos recibidos"}`
          : isEn
            ? "No payments yet"
            : "Sin pagos todavía",
      deltaLabel: formatSignedPercent(collectionDeltaFromTarget),
      deltaTone:
        collectionDeltaFromTarget < 0
          ? "warning"
          : collectionDeltaFromTarget > 0
            ? "positive"
            : "neutral",
      bars: [
        paidCollections,
        pendingCollectionsCount,
        overdueCollectionsCount,
        Math.max(collections.length - paidCollections - pendingCollectionsCount, 0),
        numberOrZero(kpiDashboard.total_collections),
        numberOrZero(kpiDashboard.paid_collections),
      ],
      barClassName: "bg-slate-400/25",
      barActiveClassName: "bg-slate-500/45",
    },
    {
      key: "pipeline",
      href: "/module/applications",
      icon: File01Icon,
      iconAccentClassName:
        "bg-orange-500/10 text-orange-600 ring-orange-500/15",
      label: isEn ? "Pipeline" : "Pipeline",
      value: String(pipelineTotal),
      helper:
        pipelineTotal > 0
          ? `${qualifiedApplications} ${isEn ? "qualified" : "calificados"} · ${pendingApplications} ${isEn ? "pending" : "pendientes"}`
          : isEn
            ? "No leads requiring action"
            : "Sin leads que requieran acción",
      deltaLabel:
        pendingApplications > 0 || operationsKpis.overdueTasks > 0
          ? isEn
            ? "Action"
            : "Acción"
          : isEn
            ? "Stable"
            : "Estable",
      deltaTone:
        pendingApplications > 0 || operationsKpis.overdueTasks > 0
          ? "warning"
          : "neutral",
      bars: [
        pipelineStatusCountMap.get("pending") ?? 0,
        pipelineStatusCountMap.get("qualified") ?? 0,
        pipelineStatusCountMap.get("visit_scheduled") ?? 0,
        pipelineStatusCountMap.get("offer_sent") ?? 0,
        pipelineStatusCountMap.get("contract_signed") ?? 0,
        pipelineStatusCountMap.get("rejected") ?? 0,
      ],
      barClassName: "bg-orange-400/25",
      barActiveClassName: "bg-orange-500/45",
    },
  ];

  const activityItems: DashboardActivityItem[] = [
    {
      key: "guest-communication",
      href: "/module/messaging",
      icon: File01Icon,
      iconAccentClassName: "bg-blue-500/10 text-blue-600 ring-blue-500/15",
      meta: isEn ? "Current queue" : "Cola actual",
      title: isEn ? "Guest Communication" : "Comunicación con huéspedes",
      description:
        activeInquiryCount > 0
          ? isEn
            ? `Active guest inquiries across ${activeInquiryCount} reservation${activeInquiryCount > 1 ? "s" : ""}.`
            : `Consultas activas de huéspedes en ${activeInquiryCount} reserva${activeInquiryCount > 1 ? "s" : ""}.`
          : isEn
            ? "No pending guest inquiries right now."
            : "No hay consultas pendientes de huéspedes ahora.",
    },
    {
      key: "maintenance-ops",
      href: "/module/operations?tab=tasks",
      icon: Task01Icon,
      iconAccentClassName:
        "bg-amber-500/10 text-amber-600 ring-amber-500/15",
      meta: isEn ? "Next 7 days" : "Próximos 7 días",
      title: isEn ? "Maintenance & Ops" : "Mantenimiento y operaciones",
      description: isEn
        ? `${operationsKpis.openTasks} open tasks, ${operationsKpis.slaBreachedTasks} SLA breach${operationsKpis.slaBreachedTasks === 1 ? "" : "es"} to triage.`
        : `${operationsKpis.openTasks} tareas abiertas, ${operationsKpis.slaBreachedTasks} incumplimiento${operationsKpis.slaBreachedTasks === 1 ? "" : "s"} SLA por revisar.`,
    },
    {
      key: "portfolio-signals",
      href: "/module/collections",
      icon: ChartIcon,
      iconAccentClassName:
        "bg-violet-500/10 text-violet-600 ring-violet-500/15",
      meta: isEn ? "Action list" : "Lista de acción",
      title: isEn ? "Portfolio Signals" : "Señales del portafolio",
      description: isEn
        ? `${overdueCollectionsCount} overdue payments and ${draftListingsCount} draft listings waiting for action.`
        : `${overdueCollectionsCount} pagos vencidos y ${draftListingsCount} anuncios borrador esperando acción.`,
    },
  ];

  const inquiryStatuses = new Set(["pending", "confirmed"]);
  const reservationRows = reservations as Record<string, unknown>[];
  const inquiryRows = reservationRows.filter((row) =>
    inquiryStatuses.has(String(row.status ?? "").toLowerCase())
  );
  const recentInquirySource = inquiryRows.length > 0 ? inquiryRows : reservationRows;
  const recentInquiries: DashboardRecentInquiry[] = [...recentInquirySource]
    .sort((a, b) =>
      compareIsoDateAsc(
        String(b.check_in_date ?? ""),
        String(a.check_in_date ?? "")
      )
    )
    .slice(0, 8)
    .map((row) => ({
      id: String(row.id ?? ""),
      guestName: String(row.guest_name ?? "").trim() || (isEn ? "Guest" : "Huésped"),
      propertyName:
        String(row.property_name ?? row.unit_name ?? "").trim() ||
        (isEn ? "Unassigned property" : "Propiedad sin asignar"),
      checkInDate: String(row.check_in_date ?? ""),
      checkOutDate: String(row.check_out_date ?? ""),
      status: String(row.status ?? "pending"),
      href: row.id
        ? `/module/reservations/${encodeURIComponent(String(row.id))}`
        : "/module/reservations",
    }));

  return (
    <div className="relative space-y-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-56 bg-[radial-gradient(circle_at_top,_var(--sidebar-primary)_0%,transparent_70%)] opacity-10" />
      <DashboardHeader
        greetingTitle={greetingTitle}
        isEn={isEn}
        quickActions={quickActionsWithCounts}
        subtitle={
          isEn
            ? "Here is your portfolio pulse and what needs attention next."
            : "Aqui tienes el pulso de tu portafolio y lo que requiere atención ahora."
        }
      />

      <DashboardQueryBar isEn={isEn} />

      <section className="space-y-4" aria-label={isEn ? "Agent activity" : "Actividad de agentes"}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-xl tracking-tight">
            {isEn ? "Agent Activity" : "Actividad de agentes"}
          </h2>
          <Link
            className="font-medium text-[var(--sidebar-primary)] text-sm hover:underline"
            href="/module/agent-dashboard"
          >
            {isEn ? "View all logs" : "Ver todo el registro"}
          </Link>
        </div>

        <div className="grid gap-3 lg:grid-cols-3">
          {activityItems.map((item) => (
            <Link
              className={cn(
                "glass-surface group rounded-2xl border border-border/60 p-4 transition-colors hover:border-[var(--sidebar-primary)]/20"
              )}
              href={item.href}
              key={item.key}
            >
              <div className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "inline-flex h-10 w-10 items-center justify-center rounded-xl ring-1 ring-inset",
                    item.iconAccentClassName
                  )}
                >
                  <Icon icon={item.icon} size={18} />
                </span>
                <span className="text-muted-foreground text-xs">{item.meta}</span>
              </div>
              <h3 className="mt-4 font-semibold text-lg tracking-tight">
                {item.title}
              </h3>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {item.description}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <DashboardTabs
        financialsContent={
          <>
            {(orgRentalMode === "ltr" || orgRentalMode === "both") &&
            apiAvailable ? (
              <DashboardFinancialKpis
                expenses={totalExpenses}
                grossRevenue={grossRevenue}
                isEn={isEn}
                kpiDashboard={kpiDashboard}
                locale={locale}
                netPayout={netPayout}
              />
            ) : null}

            <DashboardFinancialPanels
              apiAvailable={apiAvailable}
              collectionHealth={collectionHealth}
              locale={locale}
              revenueSnapshot={revenueSnapshot}
              revenueTrendData={revenueTrendData}
            />
          </>
        }
        isEn={isEn}
        operationsContent={
          <>
            <DashboardOperations
              isEn={isEn}
              operationsKpis={operationsKpis}
              propertiesCount={properties.length}
            />

            <DashboardOperationsPanels
              apiAvailable={apiAvailable}
              forecastData={forecastData}
              locale={locale}
              operationsKpis={operationsKpis}
              taskStatuses={taskStatuses}
            />

            {(orgRentalMode === "ltr" || orgRentalMode === "both") &&
            apiAvailable ? (
              <DashboardOperationalPlanningKpis
                isEn={isEn}
                kpiDashboard={kpiDashboard}
              />
            ) : null}

            <TableCard
              rowHrefBase="/module/reservations"
              rows={(reservations as Record<string, unknown>[]).slice(0, 20)}
              subtitle={isEn ? "Operations feed" : "Feed operativo"}
              title={isEn ? "Reservations summary" : "Resumen de reservas"}
            />
          </>
        }
        overviewContent={
          <>
            <DashboardOverviewSurface
              isEn={isEn}
              locale={locale}
              metrics={overviewMetrics}
              recentInquiries={recentInquiries}
            />

            {apiAvailable ? (
              <Suspense fallback={null}>
                <AnomalyAlerts locale={locale} orgId={orgId} promoted />
              </Suspense>
            ) : null}

            {apiAvailable ? (
              <Suspense fallback={null}>
                <PredictiveOutlook isEn={isEn} orgId={orgId} />
              </Suspense>
            ) : null}

            <Suspense fallback={null}>
              <DashboardNeedsAttention isEn={isEn} items={needsAttention} />
            </Suspense>

            <Suspense fallback={null}>
              <DashboardModuleCards isEn={isEn} locale={locale} />
            </Suspense>
          </>
        }
      />

      {onboardingCompleted ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn
              ? "Onboarding foundation completed"
              : "Base de onboarding completada"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Great start. Continue with channels, listings, and daily operations."
              : "Excelente inicio. Continúa con canales, anuncios y la operación diaria."}
          </AlertDescription>
        </Alert>
      ) : null}

      {apiAvailable ? (
        <GettingStartedChecklist items={checklistItems} locale={locale} />
      ) : null}
    </div>
  );
}

type DashboardActivityItem = {
  key: string;
  href: string;
  icon: ComponentProps<typeof Icon>["icon"];
  iconAccentClassName: string;
  meta: string;
  title: string;
  description: string;
};

type DashboardOverviewMetric = {
  key: string;
  href: string;
  icon: ComponentProps<typeof Icon>["icon"];
  iconAccentClassName: string;
  label: string;
  value: string;
  helper: string;
  deltaLabel: string;
  deltaTone: "positive" | "neutral" | "warning";
  bars: number[];
  barClassName: string;
  barActiveClassName: string;
};

type DashboardRecentInquiry = {
  id: string;
  guestName: string;
  propertyName: string;
  checkInDate: string;
  checkOutDate: string;
  status: string;
  href: string;
};

type DashboardOverviewSurfaceProps = {
  isEn: boolean;
  locale: string;
  metrics: DashboardOverviewMetric[];
  recentInquiries: DashboardRecentInquiry[];
};

function DashboardOverviewSurface({
  isEn,
  locale,
  metrics,
  recentInquiries,
}: DashboardOverviewSurfaceProps) {
  return (
    <section className="glass-surface overflow-hidden rounded-[26px] border border-border/60">
      <div className="grid gap-0 border-border/60 border-b md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <Link
            className={cn(
              "group relative p-5 transition-colors hover:bg-muted/25",
              "border-border/60 border-b md:border-b-0 md:border-r",
              (index + 1) % 2 === 0 && index < 2 ? "md:border-r-0 xl:border-r" : "",
              index >= 2 ? "xl:border-b-0" : "",
              index === metrics.length - 1 ? "xl:border-r-0" : ""
            )}
            href={metric.href}
            key={metric.key}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-[0.12em]">
                <span
                  className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-md ring-1 ring-inset",
                    metric.iconAccentClassName
                  )}
                >
                  <Icon icon={metric.icon} size={12} />
                </span>
                <span>{metric.label}</span>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 font-medium text-[11px]",
                  metric.deltaTone === "positive"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : metric.deltaTone === "warning"
                      ? "bg-orange-500/10 text-orange-600"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {metric.deltaLabel}
              </span>
            </div>

            <div className="mt-4 text-3xl tracking-tight">{metric.value}</div>
            <p className="mt-1 text-muted-foreground text-sm">{metric.helper}</p>

            <MetricSparkline
              barActiveClassName={metric.barActiveClassName}
              barClassName={metric.barClassName}
              values={metric.bars}
            />
          </Link>
        ))}
      </div>

      <div className="p-5 md:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="font-semibold text-xl tracking-tight">
            {isEn ? "Recent Inquiries" : "Consultas recientes"}
          </h3>
          <Link
            className="text-muted-foreground text-sm hover:text-foreground"
            href="/module/reservations"
          >
            {isEn ? "Open reservations" : "Abrir reservas"}
          </Link>
        </div>

        {recentInquiries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-5 py-12 text-center">
            <div className="mx-auto flex max-w-md flex-col items-center gap-2">
              <div className="h-10 w-10 rounded-xl border border-border/70 bg-background/70" />
              <p className="font-medium text-sm text-foreground">
                {isEn ? "No recent inquiries yet" : "Aún no hay consultas recientes"}
              </p>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "Guest conversations and booking requests will appear here as they arrive."
                  : "Las conversaciones de huéspedes y solicitudes de reserva aparecerán aquí cuando lleguen."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-border/60 border-b text-muted-foreground text-xs uppercase tracking-[0.12em]">
                  <th className="px-2 py-3 font-medium">
                    {isEn ? "Guest" : "Huésped"}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {isEn ? "Property" : "Propiedad"}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {isEn ? "Dates" : "Fechas"}
                  </th>
                  <th className="px-2 py-3 font-medium">
                    {isEn ? "Status" : "Estado"}
                  </th>
                  <th className="px-2 py-3 text-right font-medium">
                    {isEn ? "Action" : "Acción"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentInquiries.map((row) => (
                  <tr
                    className="border-border/45 border-b last:border-0 hover:bg-muted/10"
                    key={row.id || row.href}
                  >
                    <td className="px-2 py-3.5">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--sidebar-primary)]/12 font-semibold text-[var(--sidebar-primary)] text-xs">
                          {guestInitials(row.guestName)}
                        </span>
                        <span className="font-medium">{row.guestName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3.5 text-muted-foreground">
                      {row.propertyName}
                    </td>
                    <td className="px-2 py-3.5 text-muted-foreground">
                      {formatDateRangeLabel(
                        locale,
                        row.checkInDate,
                        row.checkOutDate,
                        isEn
                      )}
                    </td>
                    <td className="px-2 py-3.5">
                      <StatusBadge
                        className="rounded-full px-2.5 py-0.5 text-xs"
                        label={localizedReservationStatus(row.status, isEn)}
                        value={row.status}
                      />
                    </td>
                    <td className="px-2 py-3.5 text-right">
                      <Link
                        className="font-medium text-[var(--sidebar-primary)] text-sm hover:underline"
                        href={row.href}
                      >
                        {isEn ? "Open reservation" : "Abrir reserva"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

function MetricSparkline({
  values,
  barClassName,
  barActiveClassName,
}: {
  values: number[];
  barClassName: string;
  barActiveClassName: string;
}) {
  const finite = values.filter((value) => Number.isFinite(value));
  const baseValues = finite.length > 0 ? finite.slice(-6) : [22, 30, 28, 38, 42, 48];
  while (baseValues.length < 6) {
    baseValues.unshift(baseValues[0] ?? 20);
  }

  const max = Math.max(...baseValues, 1);
  const min = Math.min(...baseValues);
  const normalized = baseValues.map((value) => {
    if (max === min) return 42;
    return Math.round(18 + ((value - min) / (max - min)) * 54);
  });

  return (
    <div aria-hidden className="mt-4 flex h-8 items-end gap-1.5">
      {normalized.map((height, index) => (
        <span
          className={cn(
            "block min-w-0 flex-1 rounded-sm",
            index >= normalized.length - 2 ? barActiveClassName : barClassName
          )}
          key={`${index}-${height}`}
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function inferQuickActionCount(
  href: string,
  context: {
    propertiesCount: number;
    reservationsCount: number;
    pendingApplications: number;
    qualifiedApplications: number;
    expensesCount: number;
    openTasksCount: number;
    overdueTasksCount: number;
    upcomingStaysCount: number;
    overdueCollectionsCount: number;
    draftListingsCount: number;
  }
): number {
  if (href.startsWith("/module/owner-statements")) {
    return context.propertiesCount;
  }
  if (href.startsWith("/module/collections")) {
    return context.overdueCollectionsCount;
  }
  if (href.startsWith("/module/listings")) {
    return context.draftListingsCount;
  }
  if (href.startsWith("/module/reservations")) {
    return context.upcomingStaysCount || context.reservationsCount;
  }
  if (href.startsWith("/module/applications")) {
    return context.pendingApplications || context.qualifiedApplications;
  }
  if (href.startsWith("/module/operations")) {
    return context.overdueTasksCount || context.openTasksCount;
  }
  if (href.startsWith("/module/expenses")) {
    return context.expensesCount;
  }
  if (href.startsWith("/module/reports")) {
    return Math.max(context.propertiesCount, 1);
  }
  return 0;
}

function compareIsoDateAsc(a: string, b: string): number {
  const aValid = ISO_DATE_REGEX.test(a);
  const bValid = ISO_DATE_REGEX.test(b);

  if (aValid && bValid) return a.localeCompare(b);
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function computeSeriesPercentChange(values: number[]): number | null {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return null;

  const prev = finite[finite.length - 2] ?? 0;
  const current = finite[finite.length - 1] ?? 0;
  if (Math.abs(prev) < 1e-9) return current === 0 ? 0 : null;

  return ((current - prev) / Math.abs(prev)) * 100;
}

function formatSignedPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "0%";
  const abs = Math.abs(value);
  const rounded = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  const compact = rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${compact}%`;
}

function formatCompactCurrencyValue(
  amount: number,
  currency: string,
  locale: string
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(amount);
  } catch {
    return formatCurrency(amount, currency, locale);
  }
}

function guestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase() || first.toUpperCase() || "?";
}

function formatDateRangeLabel(
  locale: string,
  from: string,
  to: string,
  isEn: boolean
): string {
  if (!(ISO_DATE_REGEX.test(from) && ISO_DATE_REGEX.test(to))) {
    return isEn ? "Dates pending" : "Fechas pendientes";
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "2-digit",
  });
  const fromDate = new Date(`${from}T12:00:00`);
  const toDate = new Date(`${to}T12:00:00`);

  return `${formatter.format(fromDate)} - ${formatter.format(toDate)}`;
}

function localizedReservationStatus(status: string, isEn: boolean): string {
  const value = status.trim().toLowerCase();
  if (isEn) {
    if (value === "pending") return "Pending";
    if (value === "confirmed") return "Confirmed";
    if (value === "checked_in") return "Checked In";
    if (value === "checked_out") return "Checked Out";
    if (value === "cancelled") return "Cancelled";
    if (value === "no_show") return "No Show";
    return status || "Unknown";
  }

  if (value === "pending") return "Pendiente";
  if (value === "confirmed") return "Confirmada";
  if (value === "checked_in") return "Check-in";
  if (value === "checked_out") return "Check-out";
  if (value === "cancelled") return "Cancelada";
  if (value === "no_show") return "No show";
  return status || "Desconocido";
}

function buildNeedsAttention(
  collections: Record<string, unknown>[],
  listings: Record<string, unknown>[],
  applications: Record<string, unknown>[],
  leases: Record<string, unknown>[],
  slaBreachedTasks: number
): NeedsAttentionItem[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const needsAttention: NeedsAttentionItem[] = [];

  const overdueCollections = collections.filter((row) => {
    const status = String(row.status ?? "").toLowerCase();
    if (status === "paid" || status === "waived") return false;
    const dueDate = String(row.due_date ?? "");
    return dueDate < todayStr && ISO_DATE_REGEX.test(dueDate);
  });

  const draftListingsOld = listings.filter((row) => {
    if (row.is_published) return false;
    const created = String(row.created_at ?? "").slice(0, 10);
    if (!(created && ISO_DATE_REGEX.test(created))) return false;
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return created < sevenDaysAgo;
  });

  const expiringLeases = leases.filter((row) => {
    const status = String(row.lease_status ?? "").toLowerCase();
    if (status !== "active") return false;
    const endsOn = String(row.ends_on ?? "");
    if (!(endsOn && ISO_DATE_REGEX.test(endsOn))) return false;
    const thirtyDaysOut = new Date(Date.now() + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return endsOn <= thirtyDaysOut && endsOn >= todayStr;
  });

  const unassignedApplications = applications.filter(
    (row) => !row.assigned_user_id
  ).length;

  if (overdueCollections.length > 0) {
    needsAttention.push({
      key: "overdue-collections",
      labelEn: `${overdueCollections.length} overdue payment${overdueCollections.length > 1 ? "s" : ""}`,
      labelEs: `${overdueCollections.length} pago${overdueCollections.length > 1 ? "s" : ""} vencido${overdueCollections.length > 1 ? "s" : ""}`,
      href: "/module/collections",
      ctaEn: "Review payments",
      ctaEs: "Revisar pagos",
      priority: 1,
    });
  }

  if (draftListingsOld.length > 0) {
    needsAttention.push({
      key: "draft-listings",
      labelEn: `${draftListingsOld.length} draft listing${draftListingsOld.length > 1 ? "s" : ""} never published`,
      labelEs: `${draftListingsOld.length} anuncio${draftListingsOld.length > 1 ? "s" : ""} borrador sin publicar`,
      href: "/module/listings",
      ctaEn: "Publish",
      ctaEs: "Publicar",
      priority: 3,
    });
  }

  if (unassignedApplications > 0) {
    needsAttention.push({
      key: "unassigned-apps",
      labelEn: `${unassignedApplications} unassigned application${unassignedApplications > 1 ? "s" : ""}`,
      labelEs: `${unassignedApplications} aplicacion${unassignedApplications > 1 ? "es" : ""} sin asignar`,
      href: "/module/applications",
      ctaEn: "Assign",
      ctaEs: "Asignar",
      priority: 2,
    });
  }

  if (expiringLeases.length > 0) {
    needsAttention.push({
      key: "expiring-leases",
      labelEn: `${expiringLeases.length} lease${expiringLeases.length > 1 ? "s" : ""} expiring in 30 days`,
      labelEs: `${expiringLeases.length} contrato${expiringLeases.length > 1 ? "s" : ""} por vencer en 30 dias`,
      href: "/module/leases",
      ctaEn: "Review",
      ctaEs: "Revisar",
      priority: 4,
    });
  }

  if (slaBreachedTasks > 0) {
    needsAttention.push({
      key: "sla-breaches",
      labelEn: `${slaBreachedTasks} SLA breach${slaBreachedTasks > 1 ? "es" : ""}`,
      labelEs: `${slaBreachedTasks} incumplimiento${slaBreachedTasks > 1 ? "s" : ""} SLA`,
      href: "/module/operations?tab=tasks",
      ctaEn: "View",
      ctaEs: "Ver",
      priority: 1,
    });
  }

  needsAttention.sort((a, b) => a.priority - b.priority);
  return needsAttention;
}
