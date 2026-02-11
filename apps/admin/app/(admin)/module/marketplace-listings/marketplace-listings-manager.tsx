"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  createMarketplaceListingAction,
  publishMarketplaceListingAction,
  unpublishMarketplaceListingAction,
} from "@/app/(admin)/module/marketplace-listings/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataTable, type DataTableRow } from "@/components/ui/data-table";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/format";
import { useActiveLocale } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

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

export function MarketplaceListingsManager({
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

  const rows = useMemo(() => {
    return listings.map((row) => {
      return {
        id: asString(row.id).trim(),
        title: asString(row.title).trim(),
        public_slug: asString(row.public_slug).trim(),
        city: asString(row.city).trim() || "Asuncion",
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
        missing_required_fee_lines: Array.isArray(
          row.missing_required_fee_lines
        )
          ? row.missing_required_fee_lines
          : [],
        unit_name: asString(row.unit_name).trim() || null,
        property_name: asString(row.property_name).trim() || null,
      } satisfies DataTableRow;
    });
  }, [listings]);

  const columns = useMemo<ColumnDef<DataTableRow>[]>(() => {
    return [
      {
        accessorKey: "title",
        header: isEn ? "Listing" : "Anuncio",
        cell: ({ row, getValue }) => {
          const title = asString(getValue());
          const unit = asString(row.original.unit_name);
          const property = asString(row.original.property_name);
          const subtitle = [property, unit].filter(Boolean).join(" · ");

          return (
            <div className="space-y-1">
              <p className="font-medium">{title}</p>
              {subtitle ? (
                <p className="text-muted-foreground text-xs">{subtitle}</p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "public_slug",
        header: "Slug",
      },
      {
        accessorKey: "cover_image_url",
        header: isEn ? "Media" : "Media",
        cell: ({ row }) => {
          const cover = asString(row.original.cover_image_url);
          const gallery = Array.isArray(row.original.gallery_image_urls)
            ? row.original.gallery_image_urls
            : [];
          return (
            <div className="space-y-1">
              <Badge variant={cover ? "secondary" : "outline"}>
                {cover
                  ? isEn
                    ? "Cover image"
                    : "Imagen portada"
                  : isEn
                    ? "No cover"
                    : "Sin portada"}
              </Badge>
              <p className="text-muted-foreground text-xs">
                {isEn ? "Gallery items" : "Items galería"}: {gallery.length}
              </p>
            </div>
          );
        },
      },
      {
        accessorKey: "bedrooms",
        header: isEn ? "Specs" : "Specs",
        cell: ({ row }) => {
          const beds = asNumber(row.original.bedrooms);
          const baths = asNumber(row.original.bathrooms);
          const sqm = asNumber(row.original.square_meters);
          return (
            <p className="text-sm">
              {beds} {isEn ? "bed" : "hab"} · {baths} {isEn ? "bath" : "baño"} ·{" "}
              {sqm} m²
            </p>
          );
        },
      },
      {
        accessorKey: "is_published",
        header: isEn ? "Status" : "Estado",
        cell: ({ getValue }) => {
          return getValue() ? (
            <Badge variant="secondary">
              {isEn ? "Published" : "Publicado"}
            </Badge>
          ) : (
            <Badge variant="outline">{isEn ? "Draft" : "Borrador"}</Badge>
          );
        },
      },
      {
        accessorKey: "fee_breakdown_complete",
        header: isEn ? "Transparency" : "Transparencia",
        cell: ({ row, getValue }) => {
          const complete = getValue();
          const missing = row.original.missing_required_fee_lines;
          return complete ? (
            <Badge variant="secondary">{isEn ? "Complete" : "Completa"}</Badge>
          ) : (
            <div className="space-y-1">
              <Badge variant="outline">
                {isEn ? "Missing lines" : "Faltan líneas"}
              </Badge>
              {Array.isArray(missing) && missing.length ? (
                <p className="max-w-[220px] text-muted-foreground text-xs">
                  {missing.map((item) => asString(item)).join(", ")}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        accessorKey: "total_move_in",
        header: isEn ? "Total move-in" : "Ingreso total",
        cell: ({ row, getValue }) =>
          formatCurrency(
            asNumber(getValue()),
            asString(row.original.currency),
            locale
          ),
      },
      {
        accessorKey: "monthly_recurring_total",
        header: isEn ? "Monthly recurring" : "Mensual recurrente",
        cell: ({ row, getValue }) =>
          formatCurrency(
            asNumber(getValue()),
            asString(row.original.currency),
            locale
          ),
      },
    ];
  }, [isEn, locale]);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {rows.length} {isEn ? "listings" : "anuncios"}
        </p>
        <Button onClick={() => setOpen(true)} type="button">
          <Icon icon={PlusSignIcon} size={16} />
          {isEn ? "New listing" : "Nuevo anuncio"}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        renderRowActions={(row) => {
          const id = asString(row.id);
          const slug = asString(row.public_slug);
          const published = asBoolean(row.is_published);

          return (
            <div className="flex flex-wrap justify-end gap-2">
              {slug ? (
                <Link
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" })
                  )}
                  href={`/marketplace/${encodeURIComponent(slug)}`}
                  target="_blank"
                >
                  {isEn ? "Public" : "Público"}
                </Link>
              ) : null}

              {published ? (
                <form action={unpublishMarketplaceListingAction}>
                  <input
                    name="marketplace_listing_id"
                    type="hidden"
                    value={id}
                  />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="ghost">
                    {isEn ? "Unpublish" : "Despublicar"}
                  </Button>
                </form>
              ) : (
                <form action={publishMarketplaceListingAction}>
                  <input
                    name="marketplace_listing_id"
                    type="hidden"
                    value={id}
                  />
                  <input name="next" type="hidden" value={nextPath} />
                  <Button size="sm" type="submit" variant="secondary">
                    {isEn ? "Publish" : "Publicar"}
                  </Button>
                </form>
              )}
            </div>
          );
        }}
      />

      <Sheet
        contentClassName="max-w-2xl"
        description={
          isEn
            ? "Create a transparent public listing."
            : "Crea un anuncio público transparente."
        }
        onOpenChange={setOpen}
        open={open}
        title={isEn ? "New marketplace listing" : "Nuevo anuncio marketplace"}
      >
        <form action={createMarketplaceListingAction} className="space-y-4">
          <input name="organization_id" type="hidden" value={orgId} />
          <input name="next" type="hidden" value={nextPath} />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Title" : "Título"}</span>
              <Input name="title" required />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>Slug</span>
              <Input
                name="public_slug"
                placeholder="departamento-asuncion-centro"
                required
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "City" : "Ciudad"}</span>
              <Input defaultValue="Asuncion" name="city" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Neighborhood" : "Barrio"}</span>
              <Input name="neighborhood" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Country code" : "Código de país"}</span>
              <Input defaultValue="PY" name="country_code" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Currency" : "Moneda"}</span>
              <Select defaultValue="PYG" name="currency">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Cover image URL" : "URL imagen de portada"}</span>
              <Input
                name="cover_image_url"
                placeholder="https://.../cover.jpg"
                type="url"
              />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>
                {isEn
                  ? "Gallery image URLs (one per line)"
                  : "URLs galería (una por línea)"}
              </span>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                name="gallery_image_urls"
                placeholder={"https://.../1.jpg\nhttps://.../2.jpg"}
              />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Bedrooms" : "Habitaciones"}</span>
              <Input min={0} name="bedrooms" type="number" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Bathrooms" : "Baños"}</span>
              <Input min={0} name="bathrooms" step="0.5" type="number" />
            </label>

            <label className="space-y-1 text-sm">
              <span>{isEn ? "Area (m²)" : "Área (m²)"}</span>
              <Input min={0} name="square_meters" step="0.01" type="number" />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Pricing template" : "Plantilla de precios"}</span>
              <Select defaultValue="" name="pricing_template_id">
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
              <Select defaultValue="" name="property_id">
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
              <Select defaultValue="" name="unit_id">
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
              <Input name="summary" />
            </label>

            <label className="space-y-1 text-sm md:col-span-2">
              <span>{isEn ? "Description" : "Descripción"}</span>
              <textarea
                className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                name="description"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <Button type="submit">
              {isEn ? "Create listing" : "Crear anuncio"}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
