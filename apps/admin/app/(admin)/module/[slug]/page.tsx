import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ModuleTableCard } from "@/components/shell/module-table-card";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
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
import {
  fetchList,
  fetchOrganizations,
  fetchOwnerSummary,
} from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import {
  getModuleDescription,
  getModuleLabel,
  MODULE_BY_SLUG,
} from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

/** Helper to parse search params into extra query params — extracted from
 * the component so the React Compiler doesn't see value blocks in try/catch. */
async function buildExtraQuery(
  searchParams: Promise<Record<string, string | string[] | undefined>>
): Promise<Record<string, string>> {
  const rawSearchParams = await searchParams;
  const extraQuery: Record<string, string> = {};
  let paramsToIterate: Record<string, string | string[] | undefined>;
  if (rawSearchParams != null) {
    paramsToIterate = rawSearchParams;
  } else {
    paramsToIterate = {};
  }

  for (const [key, value] of Object.entries(paramsToIterate)) {
    if (key === "org_id") continue;
    if (key === "limit") continue;
    if (typeof value === "string") {
      extraQuery[key] = value;
    } else if (Array.isArray(value) && typeof value[0] === "string") {
      extraQuery[key] = value[0];
    }
  }
  return extraQuery;
}

type ModulePageProps = {
  params: Promise<{
    slug: string;
  }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ModulePage({
  params,
  searchParams,
}: ModulePageProps) {
  const { slug } = await params;
  const moduleDef = MODULE_BY_SLUG.get(slug);
  if (!moduleDef) {
    notFound();
  }

  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const moduleLabel = getModuleLabel(moduleDef, locale);
  const moduleDescription = getModuleDescription(moduleDef, locale);

  const orgId = await getActiveOrgId();

  if (moduleDef.slug === "organizations") {
    let rows: Record<string, unknown>[] = [];
    try {
      rows = (await fetchOrganizations(100)) as Record<string, unknown>[];
    } catch (err) {
      const message = errorMessage(err);
      return <ApiErrorCard isEn={isEn} message={message} />;
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="outline">
                {isEn ? "Onboarding module" : "Módulo de onboarding"}
              </Badge>
              <Link
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                href="/app"
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
                {isEn ? "Back to dashboard" : "Volver al panel"}
              </Link>
            </div>
            <CardTitle className="text-2xl">{moduleLabel}</CardTitle>
            <CardDescription>{moduleDescription}</CardDescription>
          </CardHeader>
        </Card>
        <ModuleTableCard
          moduleDescription={moduleDescription}
          moduleLabel={moduleLabel}
          moduleSlug={moduleDef.slug}
          rows={rows}
        />
      </div>
    );
  }

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["module records", "los registros del módulo"]}
      />
    );
  }

  if (moduleDef.kind === "report") {
    let report: Record<string, unknown>;
    try {
      report = await fetchOwnerSummary(moduleDef.endpoint, orgId);
    } catch (err) {
      let message: string;
      if (err instanceof Error) {
        message = err.message;
      } else {
        message = String(err);
      }
      return <ApiErrorCard isEn={isEn} message={message} />;
    }
    const reportRows = Object.entries(report).map(([key, value]) => ({
      metric: humanizeKey(key),
      value: typeof value === "number" ? value : String(value ?? "-"),
    }));

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="outline">
                {isEn ? "Report module" : "Módulo de informe"}
              </Badge>
              <Link
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
                href="/app"
              >
                <Icon icon={ArrowLeft01Icon} size={16} />
                {isEn ? "Back to dashboard" : "Volver al panel"}
              </Link>
            </div>
            <CardTitle className="text-2xl">{moduleLabel}</CardTitle>
            <CardDescription>{moduleDescription}</CardDescription>
          </CardHeader>
        </Card>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={isEn ? "Gross revenue" : "Ingresos brutos"}
            value={formatCurrency(report.gross_revenue, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Expenses" : "Gastos"}
            value={formatCurrency(report.expenses, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Net payout" : "Pago neto"}
            value={formatCurrency(report.net_payout, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Occupancy" : "Ocupación"}
            value={
              typeof report.occupancy_rate === "number"
                ? `${(report.occupancy_rate * 100).toFixed(1)}%`
                : "-"
            }
          />
        </section>
        <TableCard
          rows={reportRows}
          subtitle={isEn ? "Aggregate metrics" : "Métricas agregadas"}
          title={isEn ? "Report details" : "Detalles del informe"}
        />
      </div>
    );
  }

  let rows: Record<string, unknown>[] = [];

  const extraQuery = await buildExtraQuery(searchParams);

  try {
    rows = (await fetchList(
      moduleDef.endpoint,
      orgId,
      100,
      extraQuery
    )) as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="outline">
              {isEn ? "Operations module" : "Módulo de operaciones"}
            </Badge>
            <Link
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              href="/app"
            >
              <Icon icon={ArrowLeft01Icon} size={16} />
              {isEn ? "Back to dashboard" : "Volver al panel"}
            </Link>
          </div>
          <CardTitle className="text-2xl">{moduleLabel}</CardTitle>
          <CardDescription>{moduleDescription}</CardDescription>
        </CardHeader>
      </Card>
      <ModuleTableCard
        moduleDescription={moduleDescription}
        moduleLabel={moduleLabel}
        moduleSlug={moduleDef.slug}
        rows={rows}
      />
    </div>
  );
}
