"use client";

import { useRouter } from "next/navigation";

import { PropertyCard } from "@/components/properties/property-card";
import { PropertiesMapView } from "@/components/properties/properties-map-view";
import { getPropertyColumns } from "@/components/properties/property-table";
import { DataTable } from "@/components/ui/data-table";
import type {
  PropertyPortfolioRow,
  PropertyViewMode,
} from "@/lib/features/properties/types";
import type { Locale } from "@/lib/i18n";

type PropertiesListProps = {
  rows: PropertyPortfolioRow[];
  locale: Locale;
  viewMode: PropertyViewMode;
};

export function PropertiesList({
  rows,
  locale,
  viewMode,
}: PropertiesListProps) {
  const router = useRouter();
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  const onViewDetails = (id: string) => {
    router.push(`/module/properties/${id}`);
  };

  return (
    <section className="pb-12">
      {viewMode === "map" ? (
        <PropertiesMapView
          formatLocale={formatLocale}
          isEn={isEn}
          rows={rows}
        />
      ) : viewMode === "grid" ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 2xl:grid-cols-3">
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
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/50 shadow-sm backdrop-blur-sm">
          <DataTable
            columns={getPropertyColumns({ isEn, formatLocale, onViewDetails })}
            data={rows}
            hideSearch
            locale={locale}
          />
        </div>
      )}
    </section>
  );
}
