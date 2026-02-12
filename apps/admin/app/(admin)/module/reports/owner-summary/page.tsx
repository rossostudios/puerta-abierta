import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

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
import { fetchOwnerSummary, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency, humanizeKey } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function OwnerSummaryReportPage() {
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
              ? "Select an organization to load owner summary metrics."
              : "Selecciona una organización para cargar métricas de resumen del propietario."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let report: Record<string, unknown>;
  try {
    report = await fetchOwnerSummary("/reports/owner-summary", orgId);
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
              ? "Could not load owner summary from backend."
              : "No se pudo cargar el resumen del propietario desde el backend."}
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
              {isEn ? "Report detail" : "Detalle de reporte"}
            </Badge>
            <Link
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              href="/module/reports"
            >
              <Icon icon={ArrowLeft01Icon} size={16} />
              {isEn ? "Back to reports" : "Volver a reportes"}
            </Link>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Owner summary" : "Resumen del propietario"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Consolidated performance view for occupancy, revenue, expenses, and net payout."
              : "Vista consolidada de ocupación, ingresos, gastos y payout neto."}
          </CardDescription>
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
          value={`${(asNumber(report.occupancy_rate) * 100).toFixed(1)}%`}
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
