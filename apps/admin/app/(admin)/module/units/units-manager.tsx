"use client";

import { useMemo, useState } from "react";
import { createUnitFromUnitsModuleAction } from "@/app/(admin)/module/units/actions";
import { UnitsFilterBar } from "@/app/(admin)/module/units/components/units-filter-bar";
import { DataImportSheet } from "@/components/import/data-import-sheet";
import { PageHeader } from "@/components/shared/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import {
  UnitNotionTable,
  type UnitRow,
} from "@/components/units/unit-notion-table";
import type {
  UnitBedroomFilter,
  UnitStatusFilter,
  UnitViewMode,
} from "@/lib/features/units/types";
import { useActiveLocale } from "@/lib/i18n/client";

type PropertyRow = {
  id: string;
  name?: string | null;
  code?: string | null;
};

type InternalUnitRow = {
  id: string;
  property_id?: string | null;
  property_name?: string | null;
  code?: string | null;
  name?: string | null;
  max_guests?: number | string | null;
  bedrooms?: number | string | null;
  bathrooms?: number | string | null;
  currency?: string | null;
  is_active?: boolean | null;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const UNIT_CODE_SUFFIX_RE = /^(.*?)(\d+)$/;

function normalizeCode(value: string): string {
  return value.trim().toLowerCase();
}

function suggestNextUnitCode(
  code: string,
  existingCodes: Iterable<string>
): string {
  const normalizedExisting = new Set(
    Array.from(existingCodes)
      .map((item) => normalizeCode(item))
      .filter(Boolean)
  );
  const base = code.trim();
  if (!base) return "A1";
  if (!normalizedExisting.has(normalizeCode(base))) return base;

  const suffixMatch = UNIT_CODE_SUFFIX_RE.exec(base);
  if (suffixMatch) {
    const [, prefix, digits] = suffixMatch;
    const width = digits.length;
    const start = Number.parseInt(digits, 10);
    for (
      let nextValue = start + 1;
      nextValue < start + 10_000;
      nextValue += 1
    ) {
      const candidate = `${prefix}${String(nextValue).padStart(width, "0")}`;
      if (!normalizedExisting.has(normalizeCode(candidate))) {
        return candidate;
      }
    }
  }

  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!normalizedExisting.has(normalizeCode(candidate))) {
      return candidate;
    }
  }

  return `${base}-${normalizedExisting.size + 1}`;
}

export function UnitsManager({
  orgId,
  units,
  properties,
  error: errorLabel,
  success: successMessage,
}: {
  orgId: string;
  units: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  error?: string;
  success?: string;
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  /* --- filter state --- */
  const [query, setQuery] = useState("");
  const [propertyFilter, setPropertyFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<UnitStatusFilter>("all");
  const [bedroomFilter, setBedroomFilter] = useState<UnitBedroomFilter>("all");
  const [viewMode, setViewMode] = useState<UnitViewMode>("table");

  /* --- create sheet state --- */
  const [createPropertyId, setCreatePropertyId] = useState("");
  const [draftCode, setDraftCode] = useState("");

  const propertyOptions = useMemo(() => {
    return (properties as PropertyRow[])
      .map((property) => {
        const id = asString(property.id).trim();
        if (!id) return null;
        const name = asString(property.name).trim();
        const code = asString(property.code).trim();
        const label = [name, code].filter(Boolean).join(" · ");
        return { id, label: label || id };
      })
      .filter((item): item is { id: string; label: string } => Boolean(item))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [properties]);

  /* --- all rows (unfiltered) --- */
  const allRows = useMemo<UnitRow[]>(() => {
    return (units as InternalUnitRow[]).map((row) => ({
      id: asString(row.id).trim(),
      property_id: asString(row.property_id).trim() || null,
      property_name: asString(row.property_name).trim() || null,
      code: asString(row.code).trim() || null,
      name: asString(row.name).trim() || null,
      max_guests: asNumber(row.max_guests),
      bedrooms: asNumber(row.bedrooms),
      bathrooms: asNumber(row.bathrooms),
      currency: asString(row.currency).trim() || null,
      is_active:
        typeof row.is_active === "boolean"
          ? row.is_active
          : Boolean(row.is_active),
    }));
  }, [units]);

  /* --- bedroom options derived from all rows --- */
  const bedroomOptions = useMemo(() => {
    return Array.from(
      new Set(
        allRows
          .map((r) => r.bedrooms)
          .filter((b): b is number => b !== null && b !== undefined)
      )
    ).sort((a, b) => a - b);
  }, [allRows]);

  /* --- filtered rows --- */
  const filteredRows = useMemo<UnitRow[]>(() => {
    const lowerQuery = query.toLowerCase().trim();
    return allRows.filter((row) => {
      if (propertyFilter !== "all" && row.property_id !== propertyFilter)
        return false;
      if (statusFilter === "active" && !row.is_active) return false;
      if (statusFilter === "inactive" && row.is_active) return false;
      if (bedroomFilter !== "all" && row.bedrooms !== bedroomFilter)
        return false;
      if (
        lowerQuery &&
        !(
          (row.name ?? "").toLowerCase().includes(lowerQuery) ||
          (row.code ?? "").toLowerCase().includes(lowerQuery) ||
          (row.property_name ?? "").toLowerCase().includes(lowerQuery)
        )
      )
        return false;
      return true;
    });
  }, [allRows, query, propertyFilter, statusFilter, bedroomFilter]);

  /* --- create sheet helpers --- */
  const unitCodesByProperty = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const row of units as InternalUnitRow[]) {
      const propertyId = asString(row.property_id).trim();
      const code = asString(row.code).trim();
      if (!(propertyId && code)) continue;
      if (!map.has(propertyId)) {
        map.set(propertyId, new Set<string>());
      }
      map.get(propertyId)?.add(code);
    }
    return map;
  }, [units]);

  const validatedCreatePropertyId =
    createPropertyId &&
    propertyOptions.some((row) => row.id === createPropertyId)
      ? createPropertyId
      : "";

  const duplicateDraftCode = useMemo(() => {
    if (!(validatedCreatePropertyId && draftCode.trim())) return null;
    const existingCodes = unitCodesByProperty.get(validatedCreatePropertyId);
    if (!existingCodes || existingCodes.size === 0) return null;

    const normalizedDraft = normalizeCode(draftCode);
    const hasDuplicate = Array.from(existingCodes).some(
      (code) => normalizeCode(code) === normalizedDraft
    );
    if (!hasDuplicate) return null;

    return {
      suggestion: suggestNextUnitCode(draftCode, existingCodes),
    };
  }, [validatedCreatePropertyId, draftCode, unitCodesByProperty]);

  const selectedPropertyLabel = useMemo(() => {
    if (!validatedCreatePropertyId) return null;
    return propertyOptions.find(
      (property) => property.id === validatedCreatePropertyId
    )?.label;
  }, [validatedCreatePropertyId, propertyOptions]);

  const existingUnitsInSelectedProperty = useMemo(() => {
    if (!validatedCreatePropertyId) return 0;
    return (units as InternalUnitRow[]).filter(
      (row) => asString(row.property_id).trim() === validatedCreatePropertyId
    ).length;
  }, [validatedCreatePropertyId, units]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setCreatePropertyId("");
      setDraftCode("");
    }
    setOpen(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        description={
          isEn
            ? "Define rentable units with occupancy and capacity settings."
            : "Define unidades rentables con configuración de capacidad y ocupación."
        }
        onPrimaryAction={() => setOpen(true)}
        onSecondaryAction={() => setImportOpen(true)}
        primaryActionDisabled={propertyOptions.length === 0}
        primaryActionLabel={isEn ? "New unit" : "Nueva unidad"}
        recordCount={filteredRows.length}
        recordsLabel={
          isEn
            ? filteredRows.length === 1
              ? "record"
              : "records"
            : filteredRows.length === 1
              ? "registro"
              : "registros"
        }
        secondaryActionDisabled={propertyOptions.length === 0}
        secondaryActionLabel={isEn ? "Import" : "Importar"}
        title={isEn ? "Units" : "Unidades"}
      />

      {propertyOptions.length === 0 ? (
        <Alert variant="warning">
          <AlertTitle>
            {isEn ? "Create a property first" : "Crea una propiedad primero"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Units require a property. Create at least one property before adding units."
              : "Las unidades requieren una propiedad. Crea al menos una propiedad antes de agregar unidades."}
          </AlertDescription>
        </Alert>
      ) : null}

      {errorLabel ? (
        <Alert variant="destructive">
          <AlertTitle>
            {isEn
              ? "Could not complete request"
              : "No se pudo completar la solicitud"}
          </AlertTitle>
          <AlertDescription>{errorLabel}</AlertDescription>
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn ? "Success" : "Éxito"}: {successMessage}
          </AlertTitle>
        </Alert>
      ) : null}

      <UnitsFilterBar
        bedroomFilter={bedroomFilter}
        bedroomOptions={bedroomOptions}
        isEn={isEn}
        onBedroomFilterChange={setBedroomFilter}
        onPropertyFilterChange={setPropertyFilter}
        onQueryChange={setQuery}
        onStatusFilterChange={setStatusFilter}
        onViewModeChange={setViewMode}
        propertyFilter={propertyFilter}
        propertyOptions={propertyOptions}
        query={query}
        statusFilter={statusFilter}
        viewMode={viewMode}
      />

      <UnitNotionTable isEn={isEn} rows={filteredRows} />

      <Sheet
        description={
          isEn
            ? "Create a unit under an existing property."
            : "Crea una unidad dentro de una propiedad existente."
        }
        onOpenChange={handleOpenChange}
        open={open}
        title={isEn ? "New unit" : "Nueva unidad"}
      >
        <Form
          action={createUnitFromUnitsModuleAction}
          className="space-y-5"
          onSubmit={(event) => {
            if (duplicateDraftCode) {
              event.preventDefault();
            }
          }}
        >
          <input name="organization_id" type="hidden" value={orgId} />

          <div className="grid gap-2 rounded-2xl border border-border/70 bg-muted/20 p-3 sm:grid-cols-3">
            <div className="rounded-xl border border-border/70 bg-background/75 p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Property" : "Propiedad"}
              </p>
              <p className="truncate font-medium text-sm">
                {selectedPropertyLabel ??
                  (isEn ? "Select a property" : "Selecciona una propiedad")}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/75 p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Existing units" : "Unidades existentes"}
              </p>
              <p className="font-medium text-sm tabular-nums">
                {existingUnitsInSelectedProperty}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-background/75 p-3 shadow-sm">
              <p className="text-muted-foreground text-xs">
                {isEn ? "Suggested code" : "Código sugerido"}
              </p>
              <p className="font-medium text-sm">
                {duplicateDraftCode?.suggestion ?? "A1"}
              </p>
            </div>
          </div>

          <Card className="rounded-3xl border-border/70 bg-muted/20 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-0.5">
                <p className="font-medium text-sm">
                  {isEn ? "Identity" : "Identidad"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "Choose where this unit lives and how it will appear in operations."
                    : "Define dónde vive esta unidad y cómo aparecerá en operaciones."}
                </p>
              </div>

              <label className="grid gap-1">
                <span className="font-medium text-muted-foreground text-xs">
                  {isEn ? "Property" : "Propiedad"}
                </span>
                <Select
                  name="property_id"
                  onChange={(event) => setCreatePropertyId(event.target.value)}
                  required
                  value={validatedCreatePropertyId}
                >
                  <option disabled value="">
                    {isEn ? "Select a property" : "Selecciona una propiedad"}
                  </option>
                  {propertyOptions.map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.label}
                    </option>
                  ))}
                </Select>
              </label>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Code" : "Código"}
                  </span>
                  <Input
                    name="code"
                    onChange={(event) => setDraftCode(event.target.value)}
                    placeholder="A1"
                    required
                    value={draftCode}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Name" : "Nombre"}
                  </span>
                  <Input name="name" placeholder="Apto 1A" required />
                </label>
              </div>
            </CardContent>
          </Card>

          {duplicateDraftCode ? (
            <Alert variant="warning">
              <AlertTitle>
                {isEn
                  ? "This code is already used in this property"
                  : "Este código ya está en uso en esta propiedad"}
              </AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  {isEn
                    ? "Choose another code before creating the unit."
                    : "Elige otro código antes de crear la unidad."}
                </p>
                {duplicateDraftCode.suggestion &&
                normalizeCode(duplicateDraftCode.suggestion) !==
                  normalizeCode(draftCode) ? (
                  <Button
                    onClick={() => setDraftCode(duplicateDraftCode.suggestion)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {isEn
                      ? `Use ${duplicateDraftCode.suggestion}`
                      : `Usar ${duplicateDraftCode.suggestion}`}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}

          <Card className="rounded-3xl border-border/70 bg-muted/20 shadow-sm">
            <CardContent className="space-y-3 p-4">
              <div className="space-y-0.5">
                <p className="font-medium text-sm">
                  {isEn ? "Capacity profile" : "Perfil de capacidad"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isEn
                    ? "These defaults are used by leasing and occupancy workflows."
                    : "Estos valores se usan por defecto en leasing y ocupación."}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Guests" : "Huéspedes"}
                  </span>
                  <Input
                    defaultValue={2}
                    min={1}
                    name="max_guests"
                    type="number"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Bedrooms" : "Dormitorios"}
                  </span>
                  <Input
                    defaultValue={1}
                    min={0}
                    name="bedrooms"
                    type="number"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Bathrooms" : "Baños"}
                  </span>
                  <Input
                    defaultValue={1}
                    min={0}
                    name="bathrooms"
                    step="0.5"
                    type="number"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-medium text-muted-foreground text-xs">
                    {isEn ? "Currency" : "Moneda"}
                  </span>
                  <Select defaultValue="PYG" name="currency">
                    <option value="PYG">PYG</option>
                    <option value="USD">USD</option>
                  </Select>
                </label>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-2">
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              {isEn ? "Cancel" : "Cancelar"}
            </Button>
            <Button
              disabled={Boolean(duplicateDraftCode)}
              type="submit"
              variant="secondary"
            >
              {duplicateDraftCode
                ? isEn
                  ? "Resolve duplicate"
                  : "Corrige el duplicado"
                : isEn
                  ? "Create"
                  : "Crear"}
            </Button>
          </div>
        </Form>
      </Sheet>

      <DataImportSheet
        isEn={isEn}
        mode="units"
        onOpenChange={setImportOpen}
        open={importOpen}
        orgId={orgId}
        properties={propertyOptions.map((p) => ({ id: p.id, name: p.label }))}
      />
    </div>
  );
}
