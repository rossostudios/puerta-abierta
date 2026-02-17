"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import {
  createListingAction,
  publishListingAction,
  unpublishListingAction,
  updateListingAction,
} from "@/app/(admin)/module/listings/actions";
import {
  ListingNotionTable,
  type ListingSummary,
} from "@/components/listings/listing-notion-table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  AMENITY_PRESETS,
  NEIGHBORHOODS,
  PROPERTY_TYPES,
} from "@/lib/features/marketplace/constants";
import {
  CITY_CENTERS,
  CITY_DISPLAY_NAMES,
} from "@/lib/features/marketplace/geo";
import { useActiveLocale } from "@/lib/i18n/client";

import { ImageUpload } from "./listing-image-upload";

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

export type ListingRow = {
  id: string;
  title: string;
  public_slug: string;
  city: string;
  neighborhood?: string | null;
  is_published: boolean;
  fee_breakdown_complete: boolean;
  total_move_in: number;
  monthly_recurring_total: number;
  currency: string;
  cover_image_url: string | null;
  gallery_image_urls: unknown[];
  bedrooms: number;
  bathrooms: number;
  square_meters: number;
  property_type: string | null;
  furnished: boolean;
  pet_policy: string | null;
  parking_spaces: number;
  minimum_lease_months: number;
  available_from: string | null;
  amenities: unknown[];
  maintenance_fee: number;
  missing_required_fee_lines: unknown[];
  unit_name: string | null;
  property_name: string | null;
  summary?: string | null;
  description?: string | null;
  property_id?: string | null;
  unit_id?: string | null;
  pricing_template_id?: string | null;
  application_count: number;
  active_lease_count: number;
};

export function readinessScore(row: ListingRow): {
  level: "green" | "yellow" | "red";
  missing: string[];
} {
  const missing: string[] = [];
  if (!row.cover_image_url) missing.push("cover image");
  if (!row.fee_breakdown_complete) missing.push("fee breakdown");
  const amenities = Array.isArray(row.amenities) ? row.amenities : [];
  if (amenities.length < 3) missing.push("3+ amenities");
  if (!row.bedrooms) missing.push("bedrooms");
  if (!row.square_meters) missing.push("area");

  if (!row.cover_image_url || !row.fee_breakdown_complete) {
    return { level: "red", missing };
  }
  if (missing.length > 0) {
    return { level: "yellow", missing };
  }
  return { level: "green", missing: [] };
}

export function ListingsManager({
  orgId,
  listings,
  pricingTemplates,
  properties,
  units,
}: {
  orgId: string;
  listings: Record<string, unknown>[];
  pricingTemplates: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => {
    const suffix = searchParams.toString();
    return suffix ? `${pathname}?${suffix}` : pathname;
  }, [pathname, searchParams]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ListingRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [selectedCity, setSelectedCity] = useState("asuncion");
  const [checkedAmenities, setCheckedAmenities] = useState<Set<string>>(
    new Set()
  );

  const cityOptions = useMemo<ComboboxOption[]>(() => {
    return Object.keys(CITY_CENTERS).map((key) => ({
      value: key,
      label: CITY_DISPLAY_NAMES[key] ?? key,
    }));
  }, []);

  const neighborhoodOptions = useMemo<ComboboxOption[]>(() => {
    const barrios = NEIGHBORHOODS[selectedCity] ?? [];
    return barrios.map((b) => ({ value: b, label: b }));
  }, [selectedCity]);

  const toggleAmenity = useCallback((value: string) => {
    setCheckedAmenities((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else {
        next.add(value);
      }
      return next;
    });
  }, []);

  const openCreate = useCallback(() => {
    setEditing(null);
    setCheckedAmenities(new Set());
    setSelectedCity("asuncion");
    setOpen(true);
  }, []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const openEdit = useCallback((row: ListingRow) => {
    setEditing(row);
    const amenities = Array.isArray(row.amenities)
      ? new Set(row.amenities.map((a) => String(a)))
      : new Set<string>();
    setCheckedAmenities(amenities);
    const cityKey = row.city?.toLowerCase().replace(/\s+/g, "_") || "asuncion";
    setSelectedCity(
      Object.keys(CITY_CENTERS).includes(cityKey) ? cityKey : "asuncion"
    );
    setOpen(true);
  }, []);

  const rows = useMemo<ListingRow[]>(() => {
    return listings.map((row) => {
      return {
        id: asString(row.id).trim(),
        title: asString(row.title).trim(),
        public_slug: asString(row.public_slug).trim(),
        city: asString(row.city).trim() || "Asuncion",
        neighborhood: asString(row.neighborhood).trim() || null,
        is_published: asBoolean(row.is_published),
        fee_breakdown_complete: asBoolean(row.fee_breakdown_complete),
        total_move_in: asNumber(row.total_move_in),
        monthly_recurring_total: asNumber(row.monthly_recurring_total),
        currency: asString(row.currency).trim().toUpperCase() || "PYG",
        cover_image_url: asString(row.cover_image_url).trim() || null,
        gallery_image_urls: Array.isArray(row.gallery_image_urls)
          ? row.gallery_image_urls
          : [],
        bedrooms: asNumber(row.bedrooms),
        bathrooms: asNumber(row.bathrooms),
        square_meters: asNumber(row.square_meters),
        property_type: asString(row.property_type).trim() || null,
        furnished: asBoolean(row.furnished),
        pet_policy: asString(row.pet_policy).trim() || null,
        parking_spaces: asNumber(row.parking_spaces),
        minimum_lease_months: asNumber(row.minimum_lease_months),
        available_from: asString(row.available_from).trim() || null,
        amenities: Array.isArray(row.amenities) ? row.amenities : [],
        maintenance_fee: asNumber(row.maintenance_fee),
        missing_required_fee_lines: Array.isArray(
          row.missing_required_fee_lines
        )
          ? row.missing_required_fee_lines
          : [],
        unit_name: asString(row.unit_name).trim() || null,
        property_name: asString(row.property_name).trim() || null,
        summary: asString(row.summary).trim() || null,
        description: asString(row.description).trim() || null,
        property_id: asString(row.property_id).trim() || null,
        unit_id: asString(row.unit_id).trim() || null,
        pricing_template_id:
          asString(row.pricing_template_id).trim() || null,
        application_count: asNumber(row.application_count),
        active_lease_count: asNumber(row.active_lease_count),
      };
    });
  }, [listings]);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) =>
      prev.size === rows.length
        ? new Set()
        : new Set(rows.map((r) => r.id))
    );
  }, [rows]);

  const bulkAction = useCallback(
    async (action: "publish" | "unpublish") => {
      if (selectedIds.size === 0) return;
      setBulkProcessing(true);
      try {
        for (const id of selectedIds) {
          const fd = new FormData();
          fd.set("listing_id", id);
          fd.set("next", nextPath);
          if (action === "publish") {
            await publishListingAction(fd);
          } else {
            await unpublishListingAction(fd);
          }
        }
      } catch {
        // redirects will throw — that's expected
      } finally {
        setBulkProcessing(false);
        setSelectedIds(new Set());
      }
    },
    [selectedIds, nextPath]
  );

  const summary = useMemo<ListingSummary>(() => {
    const publishedCount = rows.filter((r) => r.is_published).length;
    return {
      totalCount: rows.length,
      publishedCount,
      draftCount: rows.length - publishedCount,
      totalApplications: rows.reduce(
        (sum, r) => sum + r.application_count,
        0
      ),
    };
  }, [rows]);

  const handlePublish = useCallback(
    async (listingId: string) => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      fd.set("next", nextPath);
      try {
        await publishListingAction(fd);
      } catch {
        // redirect throws — expected
      }
    },
    [nextPath]
  );

  const handleUnpublish = useCallback(
    async (listingId: string) => {
      const fd = new FormData();
      fd.set("listing_id", listingId);
      fd.set("next", nextPath);
      try {
        await unpublishListingAction(fd);
      } catch {
        // redirect throws — expected
      }
    },
    [nextPath]
  );

  const pricingTemplateOptions = useMemo(() => {
    return pricingTemplates
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return {
          id,
          label: asString(row.name).trim() || id,
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [pricingTemplates]);

  const propertyOptions = useMemo(() => {
    return properties
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return {
          id,
          label: asString(row.name).trim() || id,
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [properties]);

  const unitOptions = useMemo(() => {
    return units
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        const name = asString(row.name).trim();
        const propertyName = asString(row.property_name).trim();
        return {
          id,
          label: [propertyName, name || id].filter(Boolean).join(" · "),
        };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [units]);

  const isEditing = editing !== null;
  const formAction = isEditing ? updateListingAction : createListingAction;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {rows.length} {isEn ? "listings" : "anuncios"}
          {selectedIds.size > 0
            ? ` · ${selectedIds.size} ${isEn ? "selected" : "seleccionados"}`
            : null}
        </p>
        <div className="flex gap-2">
          {selectedIds.size > 0 ? (
            <>
              <Button
                disabled={bulkProcessing}
                onClick={() => bulkAction("publish")}
                size="sm"
                type="button"
                variant="secondary"
              >
                {isEn
                  ? `Publish (${selectedIds.size})`
                  : `Publicar (${selectedIds.size})`}
              </Button>
              <Button
                disabled={bulkProcessing}
                onClick={() => bulkAction("unpublish")}
                size="sm"
                type="button"
                variant="outline"
              >
                {isEn
                  ? `Unpublish (${selectedIds.size})`
                  : `Despublicar (${selectedIds.size})`}
              </Button>
            </>
          ) : null}
          <Button onClick={openCreate} type="button">
            <Icon icon={PlusSignIcon} size={16} />
            {isEn ? "New listing" : "Nuevo anuncio"}
          </Button>
        </div>
      </div>

      <ListingNotionTable
        formatLocale={locale as "en-US" | "es-PY"}
        isEn={isEn}
        onEditInSheet={openEdit}
        onPublish={handlePublish}
        onUnpublish={handleUnpublish}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        rows={rows}
        selectedIds={selectedIds}
        summary={summary}
      />

      <Sheet
        contentClassName="max-w-2xl"
        description={
          isEditing
            ? isEn
              ? "Update listing details."
              : "Actualiza los datos del anuncio."
            : isEn
              ? "Create a transparent public listing."
              : "Crea un anuncio público transparente."
        }
        onOpenChange={(next) => {
          if (!next) {
            setEditing(null);
          }
          setOpen(next);
        }}
        open={open}
        title={
          isEditing
            ? isEn
              ? "Edit listing"
              : "Editar anuncio"
            : isEn
              ? "New marketplace listing"
              : "Nuevo anuncio marketplace"
        }
      >
        <form
          action={formAction}
          className="space-y-4"
          key={editing?.id ?? "create"}
        >
          {isEditing ? (
            <input name="listing_id" type="hidden" value={editing.id} />
          ) : (
            <input name="organization_id" type="hidden" value={orgId} />
          )}
          <input name="next" type="hidden" value={nextPath} />
          <input name="country_code" type="hidden" value="PY" />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Title" : "Título"}</span>
              <Input
                defaultValue={editing?.title ?? ""}
                name="title"
                required
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>Slug</span>
              <Input
                defaultValue={editing?.public_slug ?? ""}
                name="public_slug"
                placeholder="departamento-asuncion-centro"
                required={!isEditing}
              />
            </label>

            <div className="space-y-1 text-sm">
              <span>{isEn ? "City" : "Ciudad"}</span>
              <Combobox
                defaultValue={selectedCity}
                name="city"
                onValueChange={setSelectedCity}
                options={cityOptions}
                placeholder={isEn ? "Select city" : "Seleccionar ciudad"}
                searchPlaceholder={isEn ? "Search city..." : "Buscar ciudad..."}
              />
            </div>

            <div className="space-y-1 text-sm">
              <span>{isEn ? "Neighborhood" : "Barrio"}</span>
              <Combobox
                allowCustom
                customLabel={(t) =>
                  isEn ? `Use: "${t}"` : `Usar: "${t}"`
                }
                defaultValue={editing?.neighborhood ?? ""}
                name="neighborhood"
                options={neighborhoodOptions}
                placeholder={
                  isEn ? "Select neighborhood" : "Seleccionar barrio"
                }
                searchPlaceholder={
                  isEn ? "Search or type..." : "Buscar o escribir..."
                }
              />
            </div>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Currency" : "Moneda"}</span>
              <Select
                defaultValue={editing?.currency ?? "PYG"}
                name="currency"
              >
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Property type" : "Tipo de propiedad"}</span>
              <Select
                defaultValue={editing?.property_type ?? ""}
                name="property_type"
              >
                <option value="">
                  {isEn ? "Select type" : "Seleccionar tipo"}
                </option>
                {PROPERTY_TYPES.map((pt) => (
                  <option key={pt.value} value={pt.value}>
                    {isEn ? pt.labelEn : pt.labelEs}
                  </option>
                ))}
              </Select>
            </label>

            <div className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Cover image" : "Imagen de portada"}</span>
              <ImageUpload
                defaultValue={editing?.cover_image_url ?? undefined}
                isEn={isEn}
                labelEn="Single cover image"
                labelEs="Una imagen de portada"
                name="cover_image_url"
                orgId={orgId}
              />
            </div>

            <div className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Gallery images" : "Imágenes de galería"}</span>
              <ImageUpload
                defaultValue={
                  editing?.gallery_image_urls?.map((u) => String(u)) ??
                  undefined
                }
                isEn={isEn}
                labelEn="Upload multiple gallery images"
                labelEs="Sube varias imágenes de galería"
                multiple
                name="gallery_image_urls"
                orgId={orgId}
              />
            </div>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Bedrooms" : "Habitaciones"}</span>
              <Input
                defaultValue={editing?.bedrooms || ""}
                min={0}
                name="bedrooms"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Bathrooms" : "Baños"}</span>
              <Input
                defaultValue={editing?.bathrooms || ""}
                min={0}
                name="bathrooms"
                step="0.5"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Area (m²)" : "Área (m²)"}</span>
              <Input
                defaultValue={editing?.square_meters || ""}
                min={0}
                name="square_meters"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Parking spaces" : "Espacios de estacionamiento"}
              </span>
              <Input
                defaultValue={editing?.parking_spaces || ""}
                min={0}
                name="parking_spaces"
                type="number"
              />
            </label>

            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                defaultChecked={editing?.furnished ?? false}
                name="furnished"
                value="true"
              />
              <span>{isEn ? "Furnished" : "Amoblado"}</span>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                defaultChecked={editing?.pet_policy === "Pets allowed"}
                name="pet_policy"
                value="Pets allowed"
              />
              <span>{isEn ? "Pets allowed" : "Se aceptan mascotas"}</span>
            </div>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Minimum lease (months)" : "Contrato mínimo (meses)"}
              </span>
              <Input
                defaultValue={editing?.minimum_lease_months || ""}
                min={1}
                name="minimum_lease_months"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Available from" : "Disponible desde"}</span>
              <DatePicker
                defaultValue={editing?.available_from ?? undefined}
                locale={locale}
                name="available_from"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Maintenance fee" : "Costo de mantenimiento"}
              </span>
              <Input
                defaultValue={editing?.maintenance_fee || ""}
                min={0}
                name="maintenance_fee"
                step="0.01"
                type="number"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>
                {isEn ? "Pricing template" : "Plantilla de precios"}
              </span>
              <Select
                defaultValue={editing?.pricing_template_id ?? ""}
                name="pricing_template_id"
              >
                <option value="">
                  {isEn ? "Select template" : "Seleccionar plantilla"}
                </option>
                {pricingTemplateOptions.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Property" : "Propiedad"}</span>
              <Select
                defaultValue={editing?.property_id ?? ""}
                name="property_id"
              >
                <option value="">{isEn ? "Optional" : "Opcional"}</option>
                {propertyOptions.map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Unit" : "Unidad"}</span>
              <Select defaultValue={editing?.unit_id ?? ""} name="unit_id">
                <option value="">{isEn ? "Optional" : "Opcional"}</option>
                {unitOptions.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </Select>
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Summary" : "Resumen"}</span>
              <Input
                defaultValue={editing?.summary ?? ""}
                name="summary"
              />
            </label>

            <div className="space-y-2 text-sm md:col-span-2">
              <span>{isEn ? "Amenities" : "Amenidades"}</span>
              <input
                name="amenities_checked"
                type="hidden"
                value={Array.from(checkedAmenities).join(",")}
              />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {AMENITY_PRESETS.map((amenity) => (
                  <label
                    className="flex items-center gap-2"
                    key={amenity.value}
                  >
                    <Checkbox
                      checked={checkedAmenities.has(amenity.value)}
                      onCheckedChange={() => toggleAmenity(amenity.value)}
                    />
                    <span>
                      {isEn ? amenity.labelEn : amenity.labelEs}
                    </span>
                  </label>
                ))}
              </div>
              <Input
                name="amenities_custom"
                placeholder={
                  isEn
                    ? "Other amenities (comma-separated)"
                    : "Otras amenidades (separadas por coma)"
                }
              />
            </div>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Description" : "Descripción"}</span>
              <Textarea
                defaultValue={editing?.description ?? ""}
                name="description"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit">
              {isEditing
                ? isEn
                  ? "Save changes"
                  : "Guardar cambios"
                : isEn
                  ? "Create listing"
                  : "Crear anuncio"}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
