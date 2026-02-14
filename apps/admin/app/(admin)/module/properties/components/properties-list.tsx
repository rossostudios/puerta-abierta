"use client";

import { useRouter } from "next/navigation";

import { PropertyCard } from "@/components/properties/property-card";
import { PropertiesMapView } from "@/components/properties/properties-map-view";
import { getPropertyColumns } from "@/components/properties/property-table";
import { DataTable } from "@/components/ui/data-table";
import { TableCell, TableFooter, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
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
};

export function PropertiesList({
  rows,
  locale,
  viewMode,
  summary,
}: PropertiesListProps) {
  const router = useRouter();
  const isEn = locale === "en-US";
  const formatLocale = isEn ? "en-US" : "es-PY";

  const onViewDetails = (id: string) => {
    router.push(`/module/properties/${id}`);
  };

  const footer = (
    <TableFooter>
      <TableRow className="hover:bg-transparent">
        {/* select column */}
        <TableCell />
        {/* name / property */}
        <TableCell className="font-medium uppercase tracking-wider">
          {rows.length} {isEn ? "Properties" : "Propiedades"}
        </TableCell>
        {/* code */}
        <TableCell />
        {/* city */}
        <TableCell />
        {/* units */}
        <TableCell className="tabular-nums">{summary.totalUnits}</TableCell>
        {/* occupancy */}
        <TableCell className="tabular-nums">
          {summary.averageOccupancy}%
        </TableCell>
        {/* status */}
        <TableCell />
        {/* revenue */}
        <TableCell className="tabular-nums">
          {formatCurrency(summary.totalRevenueMtdPyg, "PYG", formatLocale)}
        </TableCell>
        {/* tasks */}
        <TableCell className="tabular-nums">
          {summary.totalOpenTasks}
        </TableCell>
        {/* overdue */}
        <TableCell className="tabular-nums">
          {summary.totalOverdueCollections}
        </TableCell>
        {/* actions */}
        <TableCell />
      </TableRow>
    </TableFooter>
  );

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
        <DataTable
          borderless
          columns={getPropertyColumns({ isEn, formatLocale, onViewDetails })}
          data={rows}
          footer={footer}
          hideSearch
          locale={locale}
        />
      )}
    </section>
  );
}
