import { PortfolioDashboard } from "@/components/portfolio/portfolio-dashboard";
import {
  fetchPortfolioComparison,
  fetchPortfolioKpis,
  fetchPortfolioSnapshots,
  type PortfolioKpis,
  type PortfolioPropertyComparison,
  type PortfolioSnapshot,
} from "@/lib/api";
import { getActiveLocale } from "@/lib/i18n/server";
import { NoOrgCard } from "@/lib/page-helpers";
import { getActiveOrgId } from "@/lib/org";

export default async function PortfolioPage() {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <NoOrgCard isEn={isEn} resource={["portfolio", "el portafolio"]} />
    );
  }

  let kpis: PortfolioKpis | null = null;
  let properties: PortfolioPropertyComparison[] = [];
  let snapshots: PortfolioSnapshot[] = [];

  try {
    const [kpiData, compData, snapData] = await Promise.all([
      fetchPortfolioKpis(orgId).catch(() => null),
      fetchPortfolioComparison(orgId).catch(() => ({ properties: [] })),
      fetchPortfolioSnapshots(orgId, 30).catch(() => ({ snapshots: [] })),
    ]);

    kpis = kpiData;
    properties = compData.properties ?? [];
    snapshots = snapData.snapshots ?? [];
  } catch {
    // graceful degradation — empty state will render
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">
          {isEn ? "Portfolio" : "Portafolio"}
        </h1>
        <p className="text-muted-foreground text-sm">
          {isEn
            ? "Cross-property performance and analytics"
            : "Rendimiento y análisis entre propiedades"}
        </p>
      </div>

      <PortfolioDashboard
        kpis={kpis}
        locale={locale}
        properties={properties}
        snapshots={snapshots}
      />
    </div>
  );
}
