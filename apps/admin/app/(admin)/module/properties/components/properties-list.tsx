"use client";

import { SparklesIcon } from "@hugeicons/core-free-icons";

import { PropertiesMapView } from "@/components/properties/properties-map-view";
import { PropertyCard } from "@/components/properties/property-card";
import { PropertyNotionTable } from "@/components/properties/property-notion-table";
import { Icon } from "@/components/ui/icon";
import type {
  PropertyPortfolioRow,
  PropertyPortfolioSummary,
  PropertyViewMode,
} from "@/lib/features/properties/types";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { PropertyAiContext } from "../hooks/use-property-agent-status";

type PropertiesListProps = {
  rows: PropertyPortfolioRow[];
  locale: Locale;
  viewMode: PropertyViewMode;
  summary: PropertyPortfolioSummary;
  isSidebarOpen?: boolean;
  agentStatus?: "active" | "offline" | "loading";
  propertyAgentStatusMap?: Map<string, PropertyAiContext>;
};

export function PropertiesList({
  rows,
  locale,
  viewMode,
  summary,
  isSidebarOpen,
  agentStatus,
  propertyAgentStatusMap,
}: PropertiesListProps) {
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  if (rows.length === 0) {
    return (
      <section className="pb-12">
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-casaora-gradient text-white shadow-casaora">
            <Icon className="h-6 w-6" icon={SparklesIcon} />
          </div>
          <div className="space-y-1">
            <h3 className="font-semibold text-foreground text-lg">
              {isEn
                ? "Your AI-powered portfolio starts here"
                : "Tu portafolio potenciado por IA comienza aquí"}
            </h3>
            <p className="max-w-sm text-muted-foreground text-sm">
              {isEn
                ? "Connect your first property and let agents manage it 24/7."
                : "Conecta tu primera propiedad y deja que los agentes la gestionen 24/7."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="pb-12">
      {viewMode === "map" ? (
        <PropertiesMapView
          formatLocale={formatLocale}
          isEn={isEn}
          rows={rows}
        />
      ) : viewMode === "grid" ? (
        <div
          className={cn(
            "grid gap-5",
            isSidebarOpen
              ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          )}
        >
          {rows.map((row) => (
            <PropertyCard
              address={row.address || row.city}
              code={row.code}
              id={row.id}
              key={row.id}
              name={row.name}
              occupancyRate={row.occupancyRate}
              openTaskCount={row.openTaskCount}
              overdueCollectionCount={row.overdueCollectionCount}
              revenueMtdPyg={row.revenueMtdPyg}
              status={row.status}
              unitCount={row.unitCount}
              urgentTaskCount={row.urgentTaskCount}
            />
          ))}
        </div>
      ) : (
        <PropertyNotionTable
          agentStatus={agentStatus}
          formatLocale={formatLocale}
          isEn={isEn}
          isSidebarOpen={isSidebarOpen}
          propertyAgentStatusMap={propertyAgentStatusMap}
          rows={rows}
          summary={summary}
        />
      )}
    </section>
  );
}
