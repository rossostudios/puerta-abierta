"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CheckmarkCircle02Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm, useWatch, type Resolver } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { ReadinessRing } from "@/components/listings/readiness-ring";
import { ImageUpload } from "@/app/(admin)/module/listings/listing-image-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
import {
  listingFormSchema,
  type ListingFormValues,
} from "@/lib/features/listings/listing-schema";
import {
  authedFetch,
  fetchSlugAvailable,
  type ReadinessIssue,
} from "@/lib/features/listings/listings-api";
import { useListingReadiness } from "@/lib/features/listings/use-listing-readiness";
import { Icon } from "@/components/ui/icon";
import { slugify } from "@/lib/features/listings/slugify";
import type { ListingRow } from "@/app/(admin)/module/listings/listings-manager";

const READINESS_FIELD_MAP: Record<string, string> = {
  cover_image: "cover_image_url",
  amenities: "amenities",
  bedrooms: "bedrooms",
  square_meters: "square_meters",
  available_from: "available_from",
  minimum_lease: "minimum_lease_months",
  description: "description",
};

type ListingFormProps = {
  orgId: string;
  editing: ListingRow | null;
  isEn: boolean;
  locale: string;
  pricingTemplateOptions: { id: string; label: string }[];
  propertyOptions: { id: string; label: string }[];
  unitOptions: { id: string; label: string }[];
  onSuccess: () => void;
  onPreview?: () => void;
  scrollToField?: string;
};

export function ListingForm({
  orgId,
  editing,
  isEn,
  locale,
  pricingTemplateOptions,
  propertyOptions,
  unitOptions,
  onSuccess,
  onPreview,
  scrollToField,
}: ListingFormProps) {
  const queryClient = useQueryClient();
  const isEditing = editing !== null;
  const [submitting, setSubmitting] = useState(false);
  const [savedListingId, setSavedListingId] = useState<string | null>(null);
  const readinessQuery = useListingReadiness(savedListingId);

  const cityKey =
    editing?.city?.toLowerCase().replace(/\s+/g, "_") || "asuncion";
  const initialCity = Object.keys(CITY_CENTERS).includes(cityKey)
    ? cityKey
    : "asuncion";

  const form = useForm<ListingFormValues>({
    // Zod v4 coerce types differ between input/output; runtime behavior is correct
    resolver: zodResolver(listingFormSchema) as unknown as Resolver<ListingFormValues>,
    defaultValues: isEditing
      ? {
          title: editing.title,
          public_slug: editing.public_slug,
          city: initialCity,
          neighborhood: editing.neighborhood || "",
          property_type: editing.property_type || "",
          description: editing.description || "",
          summary: editing.summary || "",
          bedrooms: editing.bedrooms || undefined,
          bathrooms: editing.bathrooms || undefined,
          square_meters: editing.square_meters || undefined,
          furnished: editing.furnished,
          pet_policy: editing.pet_policy || "",
          parking_spaces: editing.parking_spaces || undefined,
          available_from: editing.available_from || "",
          minimum_lease_months: editing.minimum_lease_months || undefined,
          maintenance_fee: editing.maintenance_fee || undefined,
          cover_image_url: editing.cover_image_url || "",
          gallery_image_urls:
            editing.gallery_image_urls?.map(String) || [],
          amenities: Array.isArray(editing.amenities)
            ? editing.amenities.map(String)
            : [],
          currency: editing.currency || "PYG",
          pricing_template_id: editing.pricing_template_id || "",
          property_id: editing.property_id || "",
          unit_id: editing.unit_id || "",
          country_code: "PY",
        }
      : {
          title: "",
          public_slug: "",
          city: "asuncion",
          neighborhood: "",
          property_type: "",
          description: "",
          summary: "",
          furnished: false,
          pet_policy: "",
          available_from: "",
          cover_image_url: "",
          gallery_image_urls: [],
          amenities: [],
          currency: "PYG",
          pricing_template_id: "",
          property_id: "",
          unit_id: "",
          country_code: "PY",
        },
  });

  /* ---- Scroll to blocking field ---- */

  useEffect(() => {
    if (!scrollToField) return;
    if (scrollToField === "fee_lines") {
      toast.info(
        isEn
          ? "Fees are managed via pricing templates"
          : "Las cuotas se gestionan via plantillas de precios"
      );
      return;
    }
    const formField = READINESS_FIELD_MAP[scrollToField] ?? scrollToField;
    const el = document.querySelector(`[data-field="${formField}"]`);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const input = el.querySelector("input,textarea,select,button");
        if (input instanceof HTMLElement) input.focus();
      }, 200);
    }
  }, [scrollToField, isEn]);

  /* ---- Slug auto-generation + availability ---- */

  const [slugManual, setSlugManual] = useState(isEditing);
  const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
  const [slugChecking, setSlugChecking] = useState(false);
  const slugTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleValue = useWatch({ control: form.control, name: "title" });
  const slugValue = useWatch({ control: form.control, name: "public_slug" });

  useEffect(() => {
    if (slugManual) return;
    const generated = slugify(titleValue || "");
    form.setValue("public_slug", generated);
  }, [titleValue, slugManual, form]);

  const [prevSlugValue, setPrevSlugValue] = useState(slugValue);
  if (slugValue !== prevSlugValue) {
    setPrevSlugValue(slugValue);
    if (!slugValue?.trim()) {
      setSlugAvailable(null);
      setSlugChecking(false);
    } else {
      setSlugChecking(true);
    }
  }

  useEffect(() => {
    if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
    if (!slugValue?.trim()) return;
    const editingId = editing?.id;
    slugTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetchSlugAvailable(
          slugValue,
          orgId,
          editingId
        );
        setSlugAvailable(res.available);
        setSlugChecking(false);
      } catch {
        setSlugAvailable(null);
        setSlugChecking(false);
      }
    }, 500);
    return () => {
      if (slugTimerRef.current) clearTimeout(slugTimerRef.current);
    };
  }, [slugValue, orgId, editing?.id]);

  /* ---- City / neighborhood options ---- */

  const cityOptions: ComboboxOption[] = Object.keys(CITY_CENTERS).map(
    (key) => ({
      value: key,
      label: CITY_DISPLAY_NAMES[key] ?? key,
    })
  );

  const watchCity = useWatch({ control: form.control, name: "city" });
  const neighborhoodOptions: ComboboxOption[] = (
    NEIGHBORHOODS[watchCity] ?? []
  ).map((b) => ({ value: b, label: b }));

  /* ---- Submit ---- */

  async function onSubmit(values: ListingFormValues) {
    setSubmitting(true);

    const payload: Record<string, unknown> = {
      title: values.title,
      public_slug: values.public_slug,
      city: values.city,
      country_code: values.country_code || "PY",
      currency: (values.currency || "PYG").toUpperCase(),
    };

    // Optional fields — set null on update to clear
    const optStr = (
      key: string,
      val: string | undefined
    ) => {
      if (val) payload[key] = val;
      else if (isEditing) payload[key] = null;
    };

    const optNum = (
      key: string,
      val: number | undefined
    ) => {
      if (val !== undefined && val !== 0) payload[key] = val;
      else if (isEditing) payload[key] = null;
    };

    optStr("neighborhood", values.neighborhood);
    optStr("summary", values.summary);
    optStr("description", values.description);
    optStr("cover_image_url", values.cover_image_url);
    optStr("property_type", values.property_type);
    optStr("pet_policy", values.pet_policy);
    optStr("available_from", values.available_from);
    optStr("pricing_template_id", values.pricing_template_id);
    optStr("property_id", values.property_id);
    optStr("unit_id", values.unit_id);

    optNum("bedrooms", values.bedrooms);
    optNum("bathrooms", values.bathrooms);
    optNum("square_meters", values.square_meters);
    optNum("parking_spaces", values.parking_spaces);
    optNum("minimum_lease_months", values.minimum_lease_months);
    optNum("maintenance_fee", values.maintenance_fee);

    if (values.gallery_image_urls != null) {
      payload.gallery_image_urls = values.gallery_image_urls;
    } else {
      payload.gallery_image_urls = [];
    }
    if (values.amenities != null) {
      payload.amenities = values.amenities;
    } else {
      payload.amenities = [];
    }
    if (values.furnished != null) {
      payload.furnished = values.furnished;
    } else {
      payload.furnished = false;
    }

    const successMsg = isEditing
      ? isEn
        ? "Listing updated"
        : "Anuncio actualizado"
      : isEn
        ? "Listing created"
        : "Anuncio creado";
    const errorTitle = isEn ? "Could not save" : "No se pudo guardar";

    try {
      let resultId: string;
      if (isEditing) {
        await authedFetch(
          `/listings/${encodeURIComponent(editing.id)}`,
          { method: "PATCH", body: JSON.stringify(payload) }
        );
        resultId = editing.id;
      } else {
        const created = await authedFetch<{ id: string }>("/listings", {
          method: "POST",
          body: JSON.stringify({ ...payload, organization_id: orgId }),
        });
        resultId = created.id;
      }

      queryClient.invalidateQueries({ queryKey: ["listings"] });
      toast.success(successMsg);
      setSavedListingId(resultId);
      setSubmitting(false);
    } catch (err) {
      let description: string;
      if (err instanceof Error) {
        description = err.message;
      } else {
        description = String(err);
      }
      toast.error(errorTitle, { description });
      setSubmitting(false);
    }
  }

  function scrollToFormField(readinessField: string) {
    if (readinessField === "fee_lines") {
      toast.info(
        isEn
          ? "Fees are managed via pricing templates"
          : "Las cuotas se gestionan via plantillas de precios"
      );
      return;
    }
    const formField = READINESS_FIELD_MAP[readinessField] ?? readinessField;
    const el = document.querySelector(`[data-field="${formField}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = el.querySelector("input,textarea,select,button");
      if (input instanceof HTMLElement) input.focus();
    }
  }

  const readinessData = readinessQuery.data;
  const unsatisfied = readinessData?.issues.filter((i: ReadinessIssue) => !i.satisfied) ?? [];

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
      {savedListingId && readinessData ? (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <ReadinessRing score={readinessData.score} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">
                {isEn ? "Readiness" : "Preparación"}: {readinessData.score}%
                {unsatisfied.length > 0
                  ? ` — ${unsatisfied.length} ${isEn ? (unsatisfied.length === 1 ? "issue remaining" : "issues remaining") : (unsatisfied.length === 1 ? "pendiente" : "pendientes")}`
                  : ""}
              </p>
            </div>
          </div>
          {unsatisfied.length > 0 ? (
            <ul className="space-y-1.5">
              {unsatisfied.map((issue: ReadinessIssue) => (
                <li
                  className="flex items-center gap-2 text-sm"
                  key={issue.field}
                >
                  <Icon
                    className="text-muted-foreground/50"
                    icon={Cancel01Icon}
                    size={13}
                  />
                  <span className="text-muted-foreground">{issue.label}</span>
                  <button
                    className="ml-auto text-xs text-primary hover:underline"
                    onClick={() => scrollToFormField(issue.field)}
                    type="button"
                  >
                    {isEn ? "Fix now" : "Corregir"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            className="w-full"
            onClick={onSuccess}
            type="button"
            variant="outline"
          >
            {isEn ? "Done" : "Listo"}
          </Button>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {/* Title */}
        <label className="space-y-1 text-sm md:col-span-2">
          <span>{isEn ? "Title" : "Título"}</span>
          <Input {...form.register("title")} />
          {form.formState.errors.title && (
            <p className="text-destructive text-xs">
              {form.formState.errors.title.message}
            </p>
          )}
        </label>

        {/* Slug */}
        <div className="space-y-1 text-sm md:col-span-2">
          <span>Slug</span>
          <div className="flex items-center gap-2">
            <Input
              {...form.register("public_slug", {
                onChange: () => setSlugManual(true),
              })}
              placeholder="departamento-asuncion-centro"
            />
            <span className="flex-shrink-0">
              {slugChecking ? (
                <span className="text-muted-foreground text-xs">...</span>
              ) : slugAvailable === true ? (
                <span className="text-emerald-600 text-sm">&#10003;</span>
              ) : slugAvailable === false ? (
                <span className="text-destructive text-sm">&#10007;</span>
              ) : null}
            </span>
          </div>
          {slugValue && (
            <p className="text-muted-foreground text-xs">
              casaora.co/{slugValue}
            </p>
          )}
          {form.formState.errors.public_slug && (
            <p className="text-destructive text-xs">
              {form.formState.errors.public_slug.message}
            </p>
          )}
        </div>

        {/* City */}
        <div className="space-y-1 text-sm">
          <span>{isEn ? "City" : "Ciudad"}</span>
          <Controller
            control={form.control}
            name="city"
            render={({ field }) => (
              <Combobox
                onValueChange={field.onChange}
                options={cityOptions}
                placeholder={isEn ? "Select city" : "Seleccionar ciudad"}
                searchPlaceholder={
                  isEn ? "Search city..." : "Buscar ciudad..."
                }
                value={field.value}
              />
            )}
          />
        </div>

        {/* Neighborhood */}
        <div className="space-y-1 text-sm">
          <span>{isEn ? "Neighborhood" : "Barrio"}</span>
          <Controller
            control={form.control}
            name="neighborhood"
            render={({ field }) => (
              <Combobox
                allowCustom
                customLabel={(t) =>
                  isEn ? `Use: "${t}"` : `Usar: "${t}"`
                }
                onValueChange={field.onChange}
                options={neighborhoodOptions}
                placeholder={
                  isEn ? "Select neighborhood" : "Seleccionar barrio"
                }
                searchPlaceholder={
                  isEn ? "Search or type..." : "Buscar o escribir..."
                }
                value={field.value || ""}
              />
            )}
          />
        </div>

        {/* Currency */}
        <label className="space-y-1 text-sm">
          <span>{isEn ? "Currency" : "Moneda"}</span>
          <Select {...form.register("currency")}>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
          </Select>
        </label>

        {/* Property type */}
        <label className="space-y-1 text-sm">
          <span>{isEn ? "Property type" : "Tipo de propiedad"}</span>
          <Select {...form.register("property_type")}>
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

        {/* Cover image */}
        <div className="space-y-1 text-sm md:col-span-2" data-field="cover_image_url">
          <span>{isEn ? "Cover image" : "Imagen de portada"}</span>
          <Controller
            control={form.control}
            name="cover_image_url"
            render={({ field }) => (
              <ImageUpload
                isEn={isEn}
                labelEn="Single cover image"
                labelEs="Una imagen de portada"
                onChange={(val) =>
                  field.onChange(Array.isArray(val) ? val[0] ?? "" : val)
                }
                orgId={orgId}
                value={field.value || ""}
              />
            )}
          />
        </div>

        {/* Gallery images */}
        <div className="space-y-1 text-sm md:col-span-2">
          <span>{isEn ? "Gallery images" : "Imágenes de galería"}</span>
          <Controller
            control={form.control}
            name="gallery_image_urls"
            render={({ field }) => (
              <ImageUpload
                isEn={isEn}
                labelEn="Upload multiple gallery images"
                labelEs="Sube varias imágenes de galería"
                multiple
                onChange={(val) =>
                  field.onChange(Array.isArray(val) ? val : [val])
                }
                orgId={orgId}
                reorderable
                value={field.value || []}
              />
            )}
          />
        </div>

        {/* Bedrooms */}
        <label className="space-y-1 text-sm" data-field="bedrooms">
          <span>{isEn ? "Bedrooms" : "Habitaciones"}</span>
          <Input
            {...form.register("bedrooms")}
            min={0}
            type="number"
          />
        </label>

        {/* Bathrooms */}
        <label className="space-y-1 text-sm">
          <span>{isEn ? "Bathrooms" : "Baños"}</span>
          <Input
            {...form.register("bathrooms")}
            min={0}
            step="0.5"
            type="number"
          />
        </label>

        {/* Area */}
        <label className="space-y-1 text-sm" data-field="square_meters">
          <span>{isEn ? "Area (m²)" : "Área (m²)"}</span>
          <Input
            {...form.register("square_meters")}
            min={0}
            step="0.01"
            type="number"
          />
        </label>

        {/* Parking */}
        <label className="space-y-1 text-sm">
          <span>
            {isEn ? "Parking spaces" : "Espacios de estacionamiento"}
          </span>
          <Input
            {...form.register("parking_spaces")}
            min={0}
            type="number"
          />
        </label>

        {/* Furnished */}
        <Controller
          control={form.control}
          name="furnished"
          render={({ field }) => (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <span>{isEn ? "Furnished" : "Amoblado"}</span>
            </div>
          )}
        />

        {/* Pet policy */}
        <Controller
          control={form.control}
          name="pet_policy"
          render={({ field }) => (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={field.value === "Pets allowed"}
                onCheckedChange={(checked) =>
                  field.onChange(checked ? "Pets allowed" : "")
                }
              />
              <span>{isEn ? "Pets allowed" : "Se aceptan mascotas"}</span>
            </div>
          )}
        />

        {/* Minimum lease */}
        <label className="space-y-1 text-sm" data-field="minimum_lease_months">
          <span>
            {isEn
              ? "Minimum lease (months)"
              : "Contrato mínimo (meses)"}
          </span>
          <Input
            {...form.register("minimum_lease_months")}
            min={1}
            type="number"
          />
        </label>

        {/* Available from */}
        <div className="space-y-1 text-sm" data-field="available_from">
          <span>{isEn ? "Available from" : "Disponible desde"}</span>
          <Controller
            control={form.control}
            name="available_from"
            render={({ field }) => (
              <DatePicker
                locale={locale as "en-US" | "es-PY"}
                onValueChange={field.onChange}
                value={field.value || ""}
              />
            )}
          />
        </div>

        {/* Maintenance fee */}
        <label className="space-y-1 text-sm">
          <span>
            {isEn ? "Maintenance fee" : "Costo de mantenimiento"}
          </span>
          <Input
            {...form.register("maintenance_fee")}
            min={0}
            step="0.01"
            type="number"
          />
        </label>

        {/* Pricing template */}
        <label className="space-y-1 text-sm">
          <span>
            {isEn ? "Pricing template" : "Plantilla de precios"}
          </span>
          <Select {...form.register("pricing_template_id")}>
            <option value="">
              {isEn ? "Select template" : "Seleccionar plantilla"}
            </option>
            {pricingTemplateOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>

        {/* Property */}
        <label className="space-y-1 text-sm">
          <span>{isEn ? "Property" : "Propiedad"}</span>
          <Select {...form.register("property_id")}>
            <option value="">{isEn ? "Optional" : "Opcional"}</option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </label>

        {/* Unit */}
        <label className="space-y-1 text-sm">
          <span>{isEn ? "Unit" : "Unidad"}</span>
          <Select {...form.register("unit_id")}>
            <option value="">{isEn ? "Optional" : "Opcional"}</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </Select>
        </label>

        {/* Summary */}
        <label className="space-y-1 text-sm md:col-span-2">
          <span>{isEn ? "Summary" : "Resumen"}</span>
          <Input {...form.register("summary")} />
        </label>

        {/* Amenities */}
        <Controller
          control={form.control}
          name="amenities"
          render={({ field }) => {
            const checked = new Set(field.value ?? []);
            const toggle = (val: string) => {
              const next = new Set(checked);
              if (next.has(val)) next.delete(val);
              else next.add(val);
              field.onChange(Array.from(next));
            };
            return (
              <div className="space-y-2 text-sm md:col-span-2" data-field="amenities">
                <span>{isEn ? "Amenities" : "Amenidades"}</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {AMENITY_PRESETS.map((amenity) => (
                    <label
                      className="flex items-center gap-2"
                      key={amenity.value}
                    >
                      <Checkbox
                        checked={checked.has(amenity.value)}
                        onCheckedChange={() => toggle(amenity.value)}
                      />
                      <span>
                        {isEn ? amenity.labelEn : amenity.labelEs}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          }}
        />

        {/* Description */}
        <label className="space-y-1 text-sm md:col-span-2" data-field="description">
          <span>{isEn ? "Description" : "Descripción"}</span>
          <Textarea {...form.register("description")} />
        </label>
      </div>

      <div className="flex items-center justify-between">
        {isEditing && onPreview ? (
          <Button onClick={onPreview} type="button" variant="outline">
            {isEn ? "Preview" : "Vista previa"}
          </Button>
        ) : (
          <div />
        )}
        <Button disabled={submitting} type="submit">
          {submitting
            ? isEn
              ? "Saving..."
              : "Guardando..."
            : isEditing
              ? isEn
                ? "Save changes"
                : "Guardar cambios"
              : isEn
                ? "Create listing"
                : "Crear anuncio"}
        </Button>
      </div>
    </form>
  );
}
