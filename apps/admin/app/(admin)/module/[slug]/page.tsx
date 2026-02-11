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
  getApiBaseUrl,
} from "@/lib/api";
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
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "API connection failed" : "Fallo de conexión a la API"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Could not load module data from the backend."
                : "No se pudieron cargar los datos del módulo desde el backend."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-muted-foreground text-sm">
            <p>
              {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            <p className="break-words">{message}</p>
            <p>
              {isEn ? "Make sure" : "Asegúrate de que"}{" "}
              <span className="font-medium">FastAPI</span>{" "}
              {isEn ? "is running (from" : "esté ejecutándose (desde"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>
              ) {isEn ? "on port 8000." : " en el puerto 8000."}
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Badge variant="outline">
                {isEn ? "Setup module" : "Módulo de configuración"}
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
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn
              ? "Missing organization context"
              : "Falta contexto de organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select your organization to load module records."
              : "Selecciona una organización para cargar los registros del módulo."}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          {isEn ? (
            <>
              Pick an organization from the top bar, or create one in{" "}
              <code className="rounded bg-muted px-1 py-0.5">Setup</code>.
            </>
          ) : (
            <>
              Selecciona una organización desde la barra superior o crea una en{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                Configuración
              </code>
              .
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  if (moduleDef.kind === "report") {
    let report: Record<string, unknown>;
    try {
      report = await fetchOwnerSummary(moduleDef.endpoint, orgId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return (
        <Card>
          <CardHeader>
            <CardTitle>
              {isEn ? "API connection failed" : "Fallo de conexión a la API"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? "Could not load report data from the backend."
                : "No se pudieron cargar los datos del informe desde el backend."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-muted-foreground text-sm">
            <p>
              {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
              <code className="rounded bg-muted px-1 py-0.5">
                {getApiBaseUrl()}
              </code>
            </p>
            <p className="break-words">{message}</p>
            <p>
              {isEn ? "Make sure" : "Asegúrate de que"}{" "}
              <span className="font-medium">FastAPI</span>{" "}
              {isEn ? "is running (from" : "esté ejecutándose (desde"}{" "}
              <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>
              ) {isEn ? "on port 8000." : " en el puerto 8000."}
            </p>
          </CardContent>
        </Card>
      );
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
  try {
    const rawSearchParams = await searchParams;
    const extraQuery: Record<string, string> = {};

    for (const [key, value] of Object.entries(rawSearchParams ?? {})) {
      if (key === "org_id" || key === "limit") continue;
      if (typeof value === "string") {
        extraQuery[key] = value;
      } else if (Array.isArray(value) && typeof value[0] === "string") {
        extraQuery[key] = value[0];
      }
    }

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
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Could not load module data from the backend."
              : "No se pudieron cargar los datos del módulo desde el backend."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-muted-foreground text-sm">
          <p>
            {isEn ? "Backend base URL" : "URL base del backend"}:{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              {getApiBaseUrl()}
            </code>
          </p>
          <p className="break-words">{message}</p>
          <p>
            {isEn ? "Make sure" : "Asegúrate de que"}{" "}
            <span className="font-medium">FastAPI</span>{" "}
            {isEn ? "is running (from" : "esté ejecutándose (desde"}{" "}
            <code className="rounded bg-muted px-1 py-0.5">apps/backend</code>)
            ) {isEn ? "on port 8000." : " en el puerto 8000."}
          </p>
        </CardContent>
      </Card>
    );
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
