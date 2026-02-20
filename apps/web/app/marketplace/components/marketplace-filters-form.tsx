"use client";

import {
  FilterHorizontalIcon,
  Home01Icon,
  Location01Icon,
  Search01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import type { MarketplaceSearchFilters } from "@/lib/features/marketplace/query";

type MarketplaceFiltersFormProps = {
  isEn: boolean;
  filters: MarketplaceSearchFilters;
  activeFilters: number;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: filter controls are intentionally kept in one component for UX cohesion.
export function MarketplaceFiltersForm({
  isEn,
  filters,
  activeFilters,
}: MarketplaceFiltersFormProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-[#e8e4df] border-b">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3">
        {/* Quick Filters / Pill Bar */}
        <div className="scrollbar-hide flex flex-1 items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
          <div className="flex items-center gap-2">
            <button
              className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full border border-border/80 bg-background/50 px-5 font-semibold text-[var(--marketplace-text)] text-sm shadow-sm transition-all hover:bg-muted"
              onClick={() => setOpen(true)}
              type="button"
            >
              <Icon icon={FilterHorizontalIcon} size={15} />
              <span>{isEn ? "Filters" : "Filtros"}</span>
              {activeFilters > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-bold text-[10px] text-white">
                  {activeFilters}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>

      <Sheet
        description={
          isEn
            ? "Find the perfect place by narrowing down your options."
            : "Encuentra el lugar perfecto filtrando tus opciones."
        }
        onOpenChange={setOpen}
        open={open}
        side="right"
        title={isEn ? "Filters" : "Filtros"}
      >
        <form
          action="/marketplace"
          className="flex flex-col gap-6"
          id="marketplace-filters"
        >
          {/* Text Search */}
          <div className="flex flex-col gap-2">
            <span className="font-semibold text-[var(--marketplace-text)] text-sm">
              {isEn ? "Keyword Search" : "Búsqueda por palabra"}
            </span>
            <label
              className="inline-flex h-12 w-full items-center gap-3 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background"
              htmlFor="mkt-filter-q"
            >
              <Icon
                className="text-[var(--marketplace-text-muted)]"
                icon={Search01Icon}
                size={18}
              />
              <Input
                className="h-full w-full border-0 bg-transparent px-0 py-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                defaultValue={filters.q}
                id="mkt-filter-q"
                name="q"
                placeholder={
                  isEn
                    ? "Search title, neighborhood, or amenities"
                    : "Buscar titulo, barrio o amenities"
                }
                type="text"
              />
            </label>
          </div>

          <div className="h-px w-full bg-border/50" />

          {/* Location details */}
          <div className="flex flex-col gap-4">
            <span className="font-semibold text-[var(--marketplace-text)] text-sm">
              {isEn ? "Location Details" : "Detalles de Ubicación"}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <label
                className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background"
                htmlFor="mkt-filter-city"
              >
                <Icon
                  className="text-[var(--marketplace-text-muted)]"
                  icon={Location01Icon}
                  size={16}
                />
                <Input
                  className="h-full w-full border-0 bg-transparent px-0 py-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                  defaultValue={filters.city}
                  id="mkt-filter-city"
                  name="city"
                  placeholder={isEn ? "City" : "Ciudad"}
                  type="text"
                />
              </label>

              <label
                className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background"
                htmlFor="mkt-filter-neighborhood"
              >
                <Icon
                  className="text-[var(--marketplace-text-muted)]"
                  icon={Home01Icon}
                  size={16}
                />
                <Input
                  className="h-full w-full border-0 bg-transparent px-0 py-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                  defaultValue={filters.neighborhood}
                  id="mkt-filter-neighborhood"
                  name="neighborhood"
                  placeholder={isEn ? "Neighborhood" : "Barrio"}
                  type="text"
                />
              </label>
            </div>
          </div>

          <div className="h-px w-full bg-border/50" />

          {/* Property Attributes */}
          <div className="flex flex-col gap-4">
            <span className="font-semibold text-[var(--marketplace-text)] text-sm">
              {isEn ? "Property Attributes" : "Atributos  de Propiedad"}
            </span>

            <label
              className="flex flex-col gap-1.5"
              htmlFor="mkt-filter-property-type"
            >
              <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                {isEn ? "Type" : "Tipo"}
              </span>
              <div className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                <Icon
                  className="text-[var(--marketplace-text-muted)]"
                  icon={Home01Icon}
                  size={16}
                />
                <select
                  className="h-full w-full min-w-0 cursor-pointer appearance-none bg-transparent font-medium text-sm outline-none"
                  defaultValue={filters.propertyType || ""}
                  id="mkt-filter-property-type"
                  name="property_type"
                >
                  <option value="">
                    {isEn ? "Any Type" : "Cualquier Tipo"}
                  </option>
                  <option value="apartment">
                    {isEn ? "Apartment" : "Departamento"}
                  </option>
                  <option value="house">{isEn ? "House" : "Casa"}</option>
                  <option value="studio">
                    {isEn ? "Studio" : "Monoambiente"}
                  </option>
                  <option value="shared_room">
                    {isEn ? "Shared Room" : "Habitación Compartida"}
                  </option>
                </select>
              </div>
            </label>

            <label
              className="flex flex-col gap-1.5"
              htmlFor="mkt-filter-furnished"
            >
              <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                {isEn ? "Furnishing" : "Amoblamiento"}
              </span>
              <div className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                <Icon
                  className="text-[var(--marketplace-text-muted)]"
                  icon={Home01Icon}
                  size={16}
                />
                <select
                  className="h-full w-full min-w-0 cursor-pointer appearance-none bg-transparent font-medium text-sm outline-none"
                  defaultValue={
                    filters.furnished === undefined
                      ? ""
                      : filters.furnished
                        ? "true"
                        : "false"
                  }
                  id="mkt-filter-furnished"
                  name="furnished"
                >
                  <option value="">{isEn ? "Any" : "Cualquiera"}</option>
                  <option value="true">
                    {isEn ? "Furnished" : "Amoblado"}
                  </option>
                  <option value="false">
                    {isEn ? "Unfurnished" : "Sin amoblar"}
                  </option>
                </select>
              </div>
            </label>

            <label className="flex flex-col gap-1.5" htmlFor="mkt-filter-pets">
              <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                {isEn ? "Pet Policy" : "Mascotas"}
              </span>
              <div className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                <select
                  className="h-full w-full min-w-0 cursor-pointer appearance-none bg-transparent font-medium text-sm outline-none"
                  defaultValue={filters.petPolicy || ""}
                  id="mkt-filter-pets"
                  name="pet_policy"
                >
                  <option value="">{isEn ? "Any" : "Cualquiera"}</option>
                  <option value="allowed">
                    {isEn ? "Pets Allowed" : "Mascotas permitidas"}
                  </option>
                  <option value="cats_only">
                    {isEn ? "Cats Only" : "Solo gatos"}
                  </option>
                  <option value="dogs_only">
                    {isEn ? "Dogs Only" : "Solo perros"}
                  </option>
                  <option value="not_allowed">
                    {isEn ? "No Pets" : "Sin mascotas"}
                  </option>
                </select>
              </div>
            </label>
          </div>

          <div className="h-px w-full bg-border/50" />

          {/* Pricing constraints */}
          <div className="flex flex-col gap-4">
            <span className="font-semibold text-[var(--marketplace-text)] text-sm">
              {isEn ? "Price Range" : "Rango de Precio"}
            </span>
            <label
              className="inline-flex h-12 w-full items-center gap-2 rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background"
              htmlFor="mkt-filter-min-monthly"
            >
              <Icon
                className="text-[var(--marketplace-text-muted)]"
                icon={Wallet02Icon}
                size={18}
              />
              <Input
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 py-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                defaultValue={filters.minMonthly ?? ""}
                id="mkt-filter-min-monthly"
                min={0}
                name="min_monthly"
                placeholder={isEn ? "Min (Gs.)" : "Min (Gs.)"}
                type="number"
              />
              <span className="text-[var(--marketplace-text-muted)] text-xs">
                -
              </span>
              <Input
                className="h-full min-w-0 flex-1 border-0 bg-transparent px-4 py-0 font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                defaultValue={filters.maxMonthly ?? ""}
                min={0}
                name="max_monthly"
                placeholder={isEn ? "Max (Gs.)" : "Max (Gs.)"}
                type="number"
              />
            </label>
          </div>

          <div className="h-px w-full bg-border/50" />

          {/* Minimum Spaces */}
          <div className="flex flex-col gap-4">
            <span className="font-semibold text-[var(--marketplace-text)] text-sm">
              {isEn ? "Minimum Spaces" : "Espacios Mínimos"}
            </span>
            <div className="grid grid-cols-3 gap-3">
              <label
                className="flex flex-col gap-1.5"
                htmlFor="mkt-filter-bedrooms"
              >
                <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                  {isEn ? "Beds" : "Hab"}
                </span>
                <div className="inline-flex h-12 w-full items-center rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                  <Input
                    className="h-full w-full border-0 bg-transparent px-0 py-0 text-center font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                    defaultValue={filters.minBedrooms ?? ""}
                    id="mkt-filter-bedrooms"
                    min={0}
                    name="min_bedrooms"
                    placeholder="Any"
                    type="number"
                  />
                </div>
              </label>

              <label
                className="flex flex-col gap-1.5"
                htmlFor="mkt-filter-bathrooms"
              >
                <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                  {isEn ? "Baths" : "Baños"}
                </span>
                <div className="inline-flex h-12 w-full items-center rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                  <Input
                    className="h-full w-full border-0 bg-transparent px-0 py-0 text-center font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                    defaultValue={filters.minBathrooms ?? ""}
                    id="mkt-filter-bathrooms"
                    min={0}
                    name="min_bathrooms"
                    placeholder="Any"
                    step="0.5"
                    type="number"
                  />
                </div>
              </label>

              <label
                className="flex flex-col gap-1.5"
                htmlFor="mkt-filter-parking"
              >
                <span className="font-medium text-[var(--marketplace-text-muted)] text-xs uppercase tracking-wider">
                  {isEn ? "Parking" : "Estac."}
                </span>
                <div className="inline-flex h-12 w-full items-center rounded-2xl border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 transition-colors focus-within:border-[var(--marketplace-text)]/30 focus-within:bg-background">
                  <Input
                    className="h-full w-full border-0 bg-transparent px-0 py-0 text-center font-medium text-sm shadow-none placeholder:font-normal focus-visible:ring-0"
                    defaultValue={filters.minParking ?? ""}
                    id="mkt-filter-parking"
                    min={0}
                    name="min_parking"
                    placeholder="Any"
                    type="number"
                  />
                </div>
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-8 flex flex-col gap-3">
            <button
              className="inline-flex h-12 w-full items-center justify-center rounded-full bg-[var(--marketplace-text)] px-8 font-semibold text-[var(--marketplace-bg)] shadow-md transition-all hover:scale-[1.02] hover:opacity-90 active:scale-[0.98]"
              type="submit"
            >
              {isEn ? "Show Results" : "Mostrar Resultados"}
            </button>
            <Link
              className="inline-flex h-12 w-full items-center justify-center rounded-full border border-border/80 bg-background px-8 font-semibold text-[var(--marketplace-text)] shadow-sm transition-colors hover:bg-muted"
              href="/marketplace"
              onClick={() => setOpen(false)}
            >
              {isEn ? "Clear All Controls" : "Limpiar Todos los Controles"}
            </Link>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
