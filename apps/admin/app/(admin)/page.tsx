import {
  ArrowRight01Icon,
  CalendarCheckIn01Icon,
  ChartIcon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
  Task01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { GettingStarted } from "@/components/dashboard/getting-started";
import { DashboardInsights } from "@/components/dashboard/insights";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { StatCard } from "@/components/ui/stat-card";
import { TableCard } from "@/components/ui/table-card";
import { fetchList, fetchOwnerSummary, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getModuleDescription, getModuleLabel, MODULES } from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

function numberOrZero(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function countByStatus(
  rows: unknown[],
  preferredOrder: string[] = []
): { status: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      counts.set("unknown", (counts.get("unknown") ?? 0) + 1);
      continue;
    }
    const status = (row as Record<string, unknown>).status;
    const key =
      typeof status === "string" && status.trim() ? status.trim() : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const items = Array.from(counts.entries()).map(([status, count]) => ({
    status,
    count,
  }));
  if (!preferredOrder.length) return items;

  const rank = new Map(preferredOrder.map((key, index) => [key, index]));
  return items.sort((a, b) => {
    const aRank = rank.has(a.status) ? (rank.get(a.status) as number) : 10_000;
    const bRank = rank.has(b.status) ? (rank.get(b.status) as number) : 10_000;
    if (aRank !== bRank) return aRank - bRank;
    return a.status.localeCompare(b.status);
  });
}

async function safeList(path: string, orgId: string): Promise<unknown[]> {
  try {
    return await fetchList(path, orgId, 25);
  } catch {
    return [];
  }
}

async function safeReport(
  path: string,
  orgId: string
): Promise<Record<string, unknown>> {
  try {
    return await fetchOwnerSummary(path, orgId);
  } catch {
    return {};
  }
}

export default async function DashboardPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

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
              Open <code className="rounded bg-muted px-1 py-0.5">Setup</code>{" "}
              to create your first organization, or use the organization
              switcher in the top bar.
            </>
          ) : (
            <>
              Abre{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                Configuración
              </code>{" "}
              para crear tu primera organización, o usa el selector de
              organización en la barra superior.
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  let orgAccessError: string | null = null;
  let properties: unknown[] = [];
  let reservations: unknown[] = [];
  let tasks: unknown[] = [];
  let units: unknown[] = [];
  let summary: Record<string, unknown> = {};
  let apiAvailable = true;

  try {
    await fetchList("/organizations", orgId, 1);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    apiAvailable = false;
    orgAccessError = message;
  }

  if (apiAvailable) {
    try {
      const [props, resas, taskRows, unitRows, summ] = await Promise.all([
        safeList("/properties", orgId),
        safeList("/reservations", orgId),
        safeList("/tasks", orgId),
        safeList("/units", orgId),
        safeReport("/reports/summary", orgId),
      ]);

      properties = props;
      reservations = resas;
      tasks = taskRows;
      units = unitRows;
      summary = summ;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      apiAvailable = false;
      orgAccessError = message;
    }
  }

  const reportNet = formatCurrency(
    numberOrZero(summary.net_payout),
    "PYG",
    locale
  );
  const reportGross = formatCurrency(
    numberOrZero(summary.gross_revenue),
    "PYG",
    locale
  );
  const occupancyRate =
    typeof summary.occupancy_rate === "number"
      ? `${(summary.occupancy_rate * 100).toFixed(1)}%`
      : "0%";

  const revenueSnapshot = apiAvailable
    ? {
        periodLabel: isEn ? "This month" : "Este mes",
        currency: "PYG",
        gross: numberOrZero(summary.gross_revenue),
        expenses: numberOrZero(summary.expenses),
        net: numberOrZero(summary.net_payout),
      }
    : null;

  const taskStatuses = countByStatus(tasks as unknown[], [
    "todo",
    "in_progress",
    "done",
    "cancelled",
    "unknown",
  ]);

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────── */}
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-bold text-3xl tracking-tight">
            {isEn ? "Operations" : "Operaciones"}
          </h1>
          <p className="text-muted-foreground">
            {isEn ? "Active workspace · " : "Espacio activo · "}
            <span className="capitalize">
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date())}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
            href="/setup"
          >
            {isEn ? "Open setup" : "Abrir configuración"}
          </Link>
          <Link
            className={cn(buttonVariants({ variant: "default", size: "sm" }))}
            href="/module/reservations"
          >
            {isEn ? "View reservations" : "Ver reservas"}
            <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </div>
      </header>

      {/* ── Compact API alert ───────────────────────────────── */}
      {apiAvailable ? null : (
        <Alert aria-live="polite" variant="warning">
          <AlertTitle>
            {isEn
              ? "Can't reach the backend — metrics may be stale."
              : "No se puede conectar al backend — los datos podrían estar desactualizados."}
          </AlertTitle>
          <AlertDescription className="space-y-1.5">
            <p>
              {isEn ? "Expected at" : "Esperado en"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            {orgAccessError ? (
              <p className="break-words text-xs opacity-80">{orgAccessError}</p>
            ) : null}
            <p className="text-xs opacity-80">
              {isEn ? (
                <>
                  Run{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    cd apps/backend && npm start
                  </code>{" "}
                  then refresh this page.
                </>
              ) : (
                <>
                  Ejecuta{" "}
                  <code className="rounded bg-muted px-1 py-0.5">
                    cd apps/backend && npm start
                  </code>{" "}
                  y luego actualiza esta página.
                </>
              )}
            </p>
          </AlertDescription>
        </Alert>
      )}

      <GettingStarted
        locale={locale}
        propertyCount={properties.length}
        reservationCount={reservations.length}
        unitCount={units.length}
      />

      {/* ── KPI stats ───────────────────────────────────────── */}
      <section aria-label={isEn ? "Key metrics" : "Métricas clave"}>
        <h2 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {isEn ? "Operations" : "Operaciones"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            helper={isEn ? "Listed so far" : "Registradas hasta ahora"}
            icon={Home01Icon}
            label={isEn ? "Properties" : "Propiedades"}
            value={String(properties.length)}
          />
          <StatCard
            helper={isEn ? "Recent bookings" : "Reservas recientes"}
            icon={CalendarCheckIn01Icon}
            label={isEn ? "Reservations" : "Reservas"}
            value={String(reservations.length)}
          />
          <StatCard
            helper={isEn ? "Pending today" : "Pendientes hoy"}
            icon={Task01Icon}
            label={isEn ? "Open tasks" : "Tareas abiertas"}
            value={String(tasks.length)}
          />
        </div>
      </section>

      {/* ── Finance stats ───────────────────────────────────── */}
      <section aria-label={isEn ? "Financial overview" : "Resumen financiero"}>
        <h2 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {isEn ? "Finance" : "Finanzas"}
        </h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            helper={isEn ? "Generated this period" : "Generados este período"}
            icon={File01Icon}
            label={isEn ? "Portfolio" : "Portafolio"}
            value={String(properties.length)}
          />
          <StatCard
            helper={isEn ? "Monthly snapshot" : "Resumen del mes"}
            icon={ChartIcon}
            label={isEn ? "Gross revenue" : "Ingresos brutos"}
            value={reportGross}
          />
          <StatCard
            helper={`${isEn ? "Occupancy" : "Ocupación"} ${occupancyRate}`}
            icon={Invoice01Icon}
            label={isEn ? "Net payout" : "Pago neto"}
            value={reportNet}
          />
        </div>
      </section>

      {/* ── Insights charts ─────────────────────────────────── */}
      <DashboardInsights
        locale={locale}
        revenue={revenueSnapshot}
        taskStatuses={taskStatuses}
      />

      {/* ── Reservations table ──────────────────────────────── */}
      <TableCard
        rowHrefBase="/module/reservations"
        rows={(reservations as Record<string, unknown>[]).slice(0, 20)}
        subtitle={isEn ? "Operations feed" : "Feed operativo"}
        title={isEn ? "Reservations summary" : "Resumen de reservas"}
      />

      {/* ── Module cards (mobile only) ──────────────────────── */}
      <section className="grid gap-4 md:grid-cols-2 lg:hidden xl:grid-cols-3">
        {MODULES.map((module) => {
          const label = getModuleLabel(module, locale);
          const description = getModuleDescription(module, locale);

          return (
            <Card key={module.slug}>
              <CardHeader className="space-y-2">
                <Badge className="w-fit" variant="secondary">
                  {isEn ? "Module" : "Módulo"}
                </Badge>
                <CardTitle className="text-lg">{label}</CardTitle>
                <CardDescription>{description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={`/module/${module.slug}`}
                >
                  {isEn ? "Open module" : "Abrir módulo"}
                  <Icon icon={ArrowRight01Icon} size={14} />
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
