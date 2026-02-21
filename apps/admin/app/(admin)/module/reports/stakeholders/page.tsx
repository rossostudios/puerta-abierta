import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import dynamic from "next/dynamic";
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
import {
  fetchJson,
  fetchList,
  type KpiDashboard,
  type OperationsSummary,
} from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import type { PropertySummaryRow } from "./stakeholder-types";

const StakeholderReport = dynamic(() =>
  import("./stakeholder-report").then((m) => m.StakeholderReport)
);

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type FinanceDashboardData = {
  months?: {
    month: string;
    revenue: number;
    expenses: number;
    net: number;
    collections_scheduled: number;
    collections_paid: number;
    collection_rate: number;
  }[];
  outstanding_collections?: Record<string, unknown>[];
};

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function firstValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function isIsoDate(value: string | undefined): value is string {
  return typeof value === "string" && ISO_DATE_REGEX.test(value);
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export default async function StakeholderReportPage({
  searchParams,
}: PageProps) {
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
              ? "Select an organization to load stakeholder reporting."
              : "Selecciona una organización para cargar el reporte para stakeholders."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
    .toISOString()
    .slice(0, 10);

  const from = isIsoDate(firstValue(params.from))
    ? (firstValue(params.from) as string)
    : defaultFrom;
  const to = isIsoDate(firstValue(params.to))
    ? (firstValue(params.to) as string)
    : defaultTo;
  const propertyId = firstValue(params.property_id) ?? "";

  let properties: { id: string; name: string }[] = [];
  try {
    const propertyRows = (await fetchList("/properties", orgId, 500)) as Record<
      string,
      unknown
    >[];
    properties = propertyRows
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return {
          id,
          name: asString(row.name).trim() || id,
        };
      })
      .filter((row): row is { id: string; name: string } => Boolean(row));
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
  }

  const queryBase = {
    org_id: orgId,
    from,
    to,
  } as const;

  const [ownerResult, financeResult, operationsResult, kpiResult] =
    await Promise.allSettled([
      fetchJson<Record<string, unknown>>("/reports/owner-summary", {
        ...queryBase,
        property_id: propertyId || undefined,
      }),
      fetchJson<FinanceDashboardData>("/reports/finance-dashboard", {
        ...queryBase,
        property_id: propertyId || undefined,
      }),
      fetchJson<OperationsSummary>("/reports/operations-summary", queryBase),
      fetchJson<KpiDashboard>("/reports/kpi-dashboard", queryBase),
    ]);

  const settledResults = [
    ownerResult,
    financeResult,
    operationsResult,
    kpiResult,
  ];
  const membershipError = settledResults.some(
    (result) =>
      result.status === "rejected" &&
      isOrgMembershipError(errorMessage(result.reason))
  );
  if (membershipError) {
    return <OrgAccessChanged orgId={orgId} />;
  }

  const sectionErrors: string[] = [];

  let ownerSummary: Record<string, unknown> | null = null;
  if (ownerResult.status === "fulfilled") {
    ownerSummary = ownerResult.value;
  } else {
    sectionErrors.push(
      `${isEn ? "Owner summary" : "Resumen"}: ${errorMessage(ownerResult.reason)}`
    );
  }

  let financeData: FinanceDashboardData = {
    months: [],
    outstanding_collections: [],
  };
  if (financeResult.status === "fulfilled") {
    financeData = financeResult.value;
  } else {
    sectionErrors.push(
      `${isEn ? "Income" : "Ingresos"}: ${errorMessage(financeResult.reason)}`
    );
  }

  let operationsSummary: OperationsSummary | null = null;
  if (operationsResult.status === "fulfilled") {
    operationsSummary = operationsResult.value;
  } else {
    sectionErrors.push(
      `${isEn ? "Operations" : "Operaciones"}: ${errorMessage(operationsResult.reason)}`
    );
  }

  let kpiDashboard: KpiDashboard | null = null;
  if (kpiResult.status === "fulfilled") {
    kpiDashboard = kpiResult.value;
  } else {
    sectionErrors.push(
      `${isEn ? "KPI dashboard" : "KPIs"}: ${errorMessage(kpiResult.reason)}`
    );
  }

  let propertySummaries: PropertySummaryRow[] = [];
  if (properties.length > 0) {
    if (propertyId && ownerSummary) {
      const selected = properties.find((row) => row.id === propertyId);
      propertySummaries = [
        {
          property_id: propertyId,
          property_name: selected?.name || propertyId,
          income: asNumber(ownerSummary.gross_revenue),
          expenses: asNumber(ownerSummary.expenses),
          net_payout: asNumber(ownerSummary.net_payout),
          occupancy_rate: asNumber(ownerSummary.occupancy_rate),
        },
      ];
    } else if (!propertyId) {
      const sample = properties.slice(0, 8);
      const summaryResults = await Promise.allSettled(
        sample.map((property) =>
          fetchJson<Record<string, unknown>>("/reports/owner-summary", {
            ...queryBase,
            property_id: property.id,
          })
        )
      );

      const propertyMembershipError = summaryResults.some(
        (result) =>
          result.status === "rejected" &&
          isOrgMembershipError(errorMessage(result.reason))
      );
      if (propertyMembershipError) {
        return <OrgAccessChanged orgId={orgId} />;
      }

      const rejectedCount = summaryResults.filter(
        (result) => result.status === "rejected"
      ).length;
      if (rejectedCount > 0) {
        sectionErrors.push(
          isEn
            ? "Some property summaries could not be loaded."
            : "No se pudieron cargar algunos resúmenes por propiedad."
        );
      }

      propertySummaries = summaryResults
        .map((result, index) => {
          if (result.status !== "fulfilled") return null;
          const property = sample[index];
          return {
            property_id: property.id,
            property_name: property.name,
            income: asNumber(result.value.gross_revenue),
            expenses: asNumber(result.value.expenses),
            net_payout: asNumber(result.value.net_payout),
            occupancy_rate: asNumber(result.value.occupancy_rate),
          } satisfies PropertySummaryRow;
        })
        .filter((row): row is PropertySummaryRow => Boolean(row));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="outline">{isEn ? "Reports" : "Reportes"}</Badge>
            <Link
              className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}
              href="/module/reports"
            >
              <Icon icon={ArrowLeft01Icon} size={16} />
              {isEn ? "Back to reports" : "Volver a reportes"}
            </Link>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Stakeholder report" : "Reporte para stakeholders"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Owner-facing executive summary with income, expenses, payout, and operations risk signals."
              : "Resumen ejecutivo para propietarios con ingresos, gastos, liquidación y señales de riesgo operativo."}
          </CardDescription>
        </CardHeader>
        {sectionErrors.length > 0 ? (
          <CardContent className="space-y-1 text-muted-foreground text-xs">
            {sectionErrors.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </CardContent>
        ) : null}
      </Card>

      <StakeholderReport
        financeMonths={financeData.months ?? []}
        from={from}
        isEn={isEn}
        kpiDashboard={kpiDashboard}
        locale={locale}
        operationsSummary={operationsSummary}
        orgName={isEn ? "Organization" : "Organización"}
        outstandingCollections={financeData.outstanding_collections ?? []}
        ownerSummary={ownerSummary}
        properties={properties}
        propertyId={propertyId}
        propertySummaries={propertySummaries}
        to={to}
      />
    </div>
  );
}
