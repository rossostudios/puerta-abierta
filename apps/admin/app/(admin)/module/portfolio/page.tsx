import { Suspense } from "react";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { PortfolioDashboard } from "./portfolio-dashboard";
import { ScenarioSimulator } from "./scenario-simulator";

export default async function PortfolioPage() {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["portfolio data", "datos del portafolio"]}
      />
    );
  }

  let snapshots: Record<string, unknown>[] = [];
  let digests: Record<string, unknown>[] = [];
  let benchmarks: Record<string, unknown>[] = [];

  try {
    const [snapRows, digestRows, benchRows] = await Promise.all([
      fetchList("/portfolio-snapshots", orgId, 400).catch(
        () => [] as Record<string, unknown>[]
      ),
      fetchList("/performance-digests", orgId, 20).catch(
        () => [] as Record<string, unknown>[]
      ),
      fetchList("/portfolio-benchmarks", orgId, 50).catch(
        () => [] as Record<string, unknown>[]
      ),
    ]);
    snapshots = snapRows as Record<string, unknown>[];
    digests = digestRows as Record<string, unknown>[];
    benchmarks = benchRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message))
      return <OrgAccessChanged orgId={orgId} />;

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Intelligence</Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Portfolio" : "Portafolio"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Portfolio Dashboard" : "Panel de Portafolio"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Real-time portfolio KPIs, trends, benchmarks, and performance digests across all properties."
              : "KPIs en tiempo real, tendencias, benchmarks y resúmenes de rendimiento en todas las propiedades."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <PortfolioDashboard
              benchmarks={benchmarks}
              digests={digests}
              locale={locale}
              snapshots={snapshots}
            />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="outline">Simulator</Badge>
            <CardTitle className="text-lg">
              {isEn ? "Scenario Simulator" : "Simulador de Escenarios"}
            </CardTitle>
          </div>
          <CardDescription>
            {isEn
              ? "Project cash flows, renovation ROI, and stress test your portfolio under different market conditions."
              : "Proyecta flujos de caja, ROI de renovaciones y prueba de estrés del portafolio bajo diferentes condiciones de mercado."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ScenarioSimulator snapshots={snapshots} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
