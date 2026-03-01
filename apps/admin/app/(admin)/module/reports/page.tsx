import { ArrowRight01Icon, ChartIcon } from "@hugeicons/core-free-icons";
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
import { fetchOwnerSummary } from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { formatCurrency } from "@/lib/format";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

type HubSection = {
  href: string;
  title: { "es-PY": string; "en-US": string };
  description: { "es-PY": string; "en-US": string };
  cta: { "es-PY": string; "en-US": string };
};

const HUB_SECTIONS: HubSection[] = [
  {
    href: "/module/reports/stakeholders",
    title: {
      "es-PY": "Reporte para stakeholders",
      "en-US": "Stakeholder report",
    },
    description: {
      "es-PY":
        "Resumen ejecutivo para propietarios con KPIs financieros y operativos en un solo informe.",
      "en-US":
        "Executive owner-facing summary with financial and operations KPIs in one report.",
    },
    cta: { "es-PY": "Abrir reporte", "en-US": "Open report" },
  },
  {
    href: "/module/reports/finance",
    title: { "es-PY": "Dashboard de ingresos", "en-US": "Income dashboard" },
    description: {
      "es-PY":
        "Ingresos vs gastos, tendencia de cobro, desglose por categoría y cobros pendientes.",
      "en-US":
        "Revenue vs expenses, collection rate trend, expense breakdown, and outstanding collections.",
    },
    cta: { "es-PY": "Ver dashboard", "en-US": "Open dashboard" },
  },
  {
    href: "/module/reports/owner-summary",
    title: { "es-PY": "Resumen del propietario", "en-US": "Owner summary" },
    description: {
      "es-PY":
        "Vista consolidada de ocupación, ingresos brutos, gastos y payout neto.",
      "en-US":
        "Consolidated occupancy, gross revenue, expenses, and net payout view.",
    },
    cta: { "es-PY": "Ver resumen", "en-US": "Open summary" },
  },
  {
    href: "/module/owner-statements",
    title: { "es-PY": "Liquidaciones", "en-US": "Payout statements" },
    description: {
      "es-PY":
        "Conciliación por período con líneas detalladas de cobros, gastos y fees.",
      "en-US":
        "Period-by-period reconciliation with line-item breakdowns for collections, expenses, and fees.",
    },
    cta: { "es-PY": "Abrir liquidaciones", "en-US": "Open payout statements" },
  },
  {
    href: "/module/transparency-summary",
    title: {
      "es-PY": "Resumen de transparencia",
      "en-US": "Transparency summary",
    },
    description: {
      "es-PY":
        "KPIs de pricing transparente, conversión del funnel y salud de cobranzas.",
      "en-US":
        "KPIs for transparent pricing, funnel conversion, and collections health.",
    },
    cta: { "es-PY": "Ver KPIs", "en-US": "Open KPIs" },
  },
];

function numberValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default async function ReportsHubPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["reporting modules", "los módulos de reportes"]}
      />
    );
  }

  let ownerSummary: Record<string, unknown> | null = null;
  let summaryError: string | null = null;

  try {
    ownerSummary = await fetchOwnerSummary("/reports/owner-summary", orgId);
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    summaryError = message;
  }

  const grossRevenue = numberValue(ownerSummary?.gross_revenue);
  const expenses = numberValue(ownerSummary?.expenses);
  const netPayout = numberValue(ownerSummary?.net_payout);
  const occupancyRate = numberValue(ownerSummary?.occupancy_rate) * 100;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="outline">
              {isEn ? "Finance hub" : "Hub financiero"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Reports" : "Reportes"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Centralized reporting workspace for owner performance and transparency metrics."
              : "Espacio centralizado de reportes para desempeño del propietario y métricas de transparencia."}
          </CardDescription>
        </CardHeader>
      </Card>

      {summaryError ? (
        <ApiErrorCard isEn={isEn} message={summaryError} />
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label={isEn ? "Gross revenue" : "Ingresos brutos"}
            value={formatCurrency(grossRevenue, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Expenses" : "Gastos"}
            value={formatCurrency(expenses, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Net payout" : "Pago neto"}
            value={formatCurrency(netPayout, "PYG", locale)}
          />
          <StatCard
            label={isEn ? "Occupancy" : "Ocupación"}
            value={`${occupancyRate.toFixed(1)}%`}
          />
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        {HUB_SECTIONS.map((section) => (
          <Card className="h-full" key={section.href}>
            <CardHeader className="space-y-2">
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border/80 bg-muted/45">
                <Icon icon={ChartIcon} size={17} />
              </div>
              <CardTitle className="text-lg">{section.title[locale]}</CardTitle>
              <CardDescription>{section.description[locale]}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href={section.href}
              >
                {section.cta[locale]}
                <Icon icon={ArrowRight01Icon} size={15} />
              </Link>
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
