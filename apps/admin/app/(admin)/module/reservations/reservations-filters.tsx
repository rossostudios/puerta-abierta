"use client";

import { ReservationsExportButton } from "@/components/reservations/reservations-export-button";
import { DatePicker } from "@/components/ui/date-picker";
import { type DataTableRow } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { humanizeStatus, type UnitOption } from "@/app/(admin)/module/reservations/reservations-types";
import type { Locale } from "@/lib/i18n";

export function ReservationsFilters({
  from,
  isEn,
  locale,
  onFromChange,
  onQueryChange,
  onSourceFilterChange,
  onStatusChange,
  onToChange,
  onUnitIdChange,
  query,
  filteredRows,
  sourceFilter,
  status,
  to,
  total,
  unitId,
  unitOptions,
}: {
  from: string;
  isEn: boolean;
  locale: Locale;
  onFromChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onSourceFilterChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onToChange: (value: string) => void;
  onUnitIdChange: (value: string) => void;
  query: string;
  filteredRows: DataTableRow[];
  sourceFilter: string;
  status: string;
  to: string;
  total: number;
  unitId: string;
  unitOptions: UnitOption[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid w-full gap-2 md:grid-cols-5">
        <label className="space-y-1" htmlFor="res-filter-search">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Search" : "Buscar"}
          </span>
          <Input
            id="res-filter-search"
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={
              isEn ? "Guest, unit, status..." : "Huésped, unidad, estado..."
            }
            value={query}
          />
        </label>

        <label className="space-y-1" htmlFor="res-filter-status">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Status" : "Estado"}
          </span>
          <Select
            id="res-filter-status"
            onChange={(event) => onStatusChange(event.target.value)}
            value={status}
          >
            <option value="all">{isEn ? "All" : "Todos"}</option>
            <option value="pending">{humanizeStatus("pending", isEn)}</option>
            <option value="confirmed">
              {humanizeStatus("confirmed", isEn)}
            </option>
            <option value="checked_in">
              {humanizeStatus("checked_in", isEn)}
            </option>
            <option value="checked_out">
              {humanizeStatus("checked_out", isEn)}
            </option>
            <option value="cancelled">
              {humanizeStatus("cancelled", isEn)}
            </option>
            <option value="no_show">
              {humanizeStatus("no_show", isEn)}
            </option>
          </Select>
        </label>

        <label className="space-y-1" htmlFor="res-filter-unit">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Unit" : "Unidad"}
          </span>
          <Select
            id="res-filter-unit"
            onChange={(event) => onUnitIdChange(event.target.value)}
            value={unitId}
          >
            <option value="all">{isEn ? "All units" : "Todas"}</option>
            {unitOptions.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-1" htmlFor="res-filter-source">
          <span className="block font-medium text-muted-foreground text-xs">
            {isEn ? "Source" : "Origen"}
          </span>
          <Select
            id="res-filter-source"
            onChange={(event) => onSourceFilterChange(event.target.value)}
            value={sourceFilter}
          >
            <option value="all">{isEn ? "All sources" : "Todos"}</option>
            <option value="manual">Manual</option>
            <option value="direct_booking">Marketplace</option>
            <option value="external">{isEn ? "External" : "Externo"}</option>
          </Select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1" htmlFor="res-filter-from">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "From" : "Desde"}
            </span>
            <DatePicker
              id="res-filter-from"
              locale={locale}
              max={to || undefined}
              onValueChange={onFromChange}
              value={from}
            />
          </label>
          <label className="space-y-1" htmlFor="res-filter-to">
            <span className="block font-medium text-muted-foreground text-xs">
              {isEn ? "To" : "Hasta"}
            </span>
            <DatePicker
              id="res-filter-to"
              locale={locale}
              min={from || undefined}
              onValueChange={onToChange}
              value={to}
            />
          </label>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span className="text-muted-foreground text-sm">
          {total} {isEn ? (total === 1 ? "record" : "records") : (total === 1 ? "registro" : "registros")}
        </span>
        <ReservationsExportButton
          format="csv"
          isEn={isEn}
          locale={locale}
          rows={filteredRows as Parameters<typeof ReservationsExportButton>[0]["rows"]}
        />
        <ReservationsExportButton
          format="pdf"
          isEn={isEn}
          locale={locale}
          rows={filteredRows as Parameters<typeof ReservationsExportButton>[0]["rows"]}
        />
      </div>
    </div>
  );
}
