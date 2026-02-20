"use client";

import { PropertiesMapView } from "@/components/properties/properties-map-view";
import { PropertyCard } from "@/components/properties/property-card";
import { PropertyNotionTable } from "@/components/properties/property-notion-table";
import type {
  PropertyPortfolioRow,
  PropertyPortfolioSummary,
  PropertyViewMode,
} from "@/lib/features/properties/types";
import type { Locale } from "@/lib/i18n";

type PropertiesListProps = {
  rows: PropertyPortfolioRow[];
  locale: Locale;
  viewMode: PropertyViewMode;
  summary: PropertyPortfolioSummary;
  isSidebarOpen?: boolean;
};

export function PropertiesList({
  rows,
  locale,
  viewMode,
  summary,
  isSidebarOpen,
}: PropertiesListProps) {
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  return (
    <section className="pb-12">
      {viewMode === "map" ? (
        <PropertiesMapView
          formatLocale={formatLocale}
          isEn={isEn}
          rows={rows}
        />
      ) : viewMode === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <PropertyCard
              address={row.address || row.city}
              code={row.code}
              health={row.health}
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
          formatLocale={formatLocale}
          isEn={isEn}
          isSidebarOpen={isSidebarOpen}
          rows={rows}
          summary={summary}
        />
      )}
    </section>
  );
}
