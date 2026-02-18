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
import { fetchJson } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

import dynamic from "next/dynamic";

const FinanceDashboard = dynamic(() =>
  import("./finance-dashboard").then((m) => m.FinanceDashboard)
);

type FinanceDashboardData = {
  organization_id?: string;
  months?: {
    month: string;
    revenue: number;
    expenses: number;
    net: number;
    collections_scheduled: number;
    collections_paid: number;
    collection_rate: number;
  }[];
  expense_breakdown?: { category: string; total: number }[];
  outstanding_collections?: Record<string, unknown>[];
};

export default async function FinanceDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Missing organization" : "Falta organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to view the financial dashboard."
              : "Selecciona una organización para ver el dashboard financiero."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const params = await searchParams;
  const today = new Date();
  const defaultTo = today.toISOString().slice(0, 10);
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1)
    .toISOString()
    .slice(0, 10);

  const from =
    typeof params.from === "string" && params.from ? params.from : defaultFrom;
  const to =
    typeof params.to === "string" && params.to ? params.to : defaultTo;
  const propertyId =
    typeof params.property_id === "string" ? params.property_id : "";

  let data: FinanceDashboardData = {};
  const apiParams: Record<string, string> = { org_id: orgId, from, to };
  if (propertyId) apiParams.property_id = propertyId;

  let properties: Record<string, unknown>[] = [];
  try {
    const propResult = await fetchJson<{ items?: Record<string, unknown>[] }>(
      "/properties",
      { org_id: orgId }
    );
    properties = propResult.items ?? [];
  } catch {
    // non-critical — filter will just be empty
  }

  try {
    data = await fetchJson<FinanceDashboardData>(
      "/reports/finance-dashboard",
      apiParams
    );
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err)))
      return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Financial Dashboard" : "Dashboard Financiero"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Failed to load finance data."
              : "Error al cargar datos financieros."}
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
              {isEn ? "Finance" : "Finanzas"}
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
            {isEn ? "Financial Dashboard" : "Dashboard Financiero"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Revenue, expenses, collection rates, and expense breakdown."
              : "Ingresos, gastos, tasas de cobro y desglose de gastos."}
          </CardDescription>
        </CardHeader>
      </Card>

      <FinanceDashboard
        expenseBreakdown={data.expense_breakdown ?? []}
        filterFrom={from}
        filterPropertyId={propertyId}
        filterTo={to}
        locale={locale}
        months={data.months ?? []}
        outstandingCollections={data.outstanding_collections ?? []}
        properties={properties}
      />
    </div>
  );
}
