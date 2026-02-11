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

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export default async function TransparencySummaryModulePage() {
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
              ? "Select an organization to load transparency KPIs."
              : "Selecciona una organización para cargar KPIs de transparencia."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let report: Record<string, unknown>;
  try {
    report = await fetchOwnerSummary("/reports/transparency-summary", orgId);
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
              ? "Could not load transparency summary from backend."
              : "No se pudo cargar el resumen de transparencia desde el backend."}
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

  const transparentListingsPct =
    asNumber(report.transparent_listings_pct) * 100;
  const inquiryToQualifiedPct =
    asNumber(report.inquiry_to_qualified_rate) * 100;
  const collectionSuccessPct = asNumber(report.collection_success_rate) * 100;
  const medianFirstResponseHours = asOptionalNumber(
    report.median_first_response_hours
  );
  const paidCollectionsAmount = asNumber(report.paid_collections_amount);

  const detailRows = Object.entries(report).map(([key, value]) => ({
    metric: humanizeKey(key),
    value: typeof value === "number" ? value : String(value ?? "-"),
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="outline">
              {isEn ? "KPI module" : "Módulo de KPIs"}
            </Badge>
            <Link
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              href="/"
            >
              <Icon icon={ArrowLeft01Icon} size={16} />
              {isEn ? "Back to dashboard" : "Volver al panel"}
            </Link>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Transparency summary" : "Resumen de transparencia"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Weekly view of listing transparency, applications pipeline response, and collection execution."
              : "Vista semanal de transparencia en anuncios, respuesta del pipeline de aplicaciones y ejecución de cobros."}
          </CardDescription>
        </CardHeader>
      </Card>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label={isEn ? "Transparent listings %" : "Anuncios transparentes %"}
          value={`${transparentListingsPct.toFixed(1)}%`}
        />
        <StatCard
          label={isEn ? "Inquiry -> qualified %" : "Consulta -> calificada %"}
          value={`${inquiryToQualifiedPct.toFixed(1)}%`}
        />
        <StatCard
          label={
            isEn ? "Median first response (h)" : "Mediana primera respuesta (h)"
          }
          value={
            medianFirstResponseHours === null
              ? "-"
              : medianFirstResponseHours.toFixed(2)
          }
        />
        <StatCard
          label={isEn ? "Collection success %" : "Éxito de cobros %"}
          value={`${collectionSuccessPct.toFixed(1)}%`}
        />
        <StatCard
          label={isEn ? "Paid collections amount" : "Monto cobrado pagado"}
          value={formatCurrency(paidCollectionsAmount, "PYG", locale)}
        />
      </section>

      <TableCard
        rows={detailRows}
        subtitle={isEn ? "Raw metrics payload" : "Payload crudo de métricas"}
        title={isEn ? "Transparency details" : "Detalle de transparencia"}
      />
    </div>
  );
}
