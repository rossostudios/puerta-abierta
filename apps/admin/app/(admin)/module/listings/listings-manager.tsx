"use client";

import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ListingForm } from "@/components/listings/listing-form";
import { ListingNotionTable } from "@/components/listings/listing-notion-table";
import { ListingPreviewModal } from "@/components/listings/listing-preview-modal";
import type { SavedView } from "@/lib/features/listings/saved-views";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { authedFetch } from "@/lib/features/listings/listings-api";
import { useListingsQuery } from "@/lib/features/listings/use-listings-query";
import type { Locale } from "@/lib/i18n";
import { useActiveLocale } from "@/lib/i18n/client";

/* ---------- helpers ---------- */

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

/* ---------- types ---------- */

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
  readiness_score: number;
  readiness_blocking: string[];
};

/* ---------- row normalizer ---------- */

function toListingRow(row: Record<string, unknown>): ListingRow {
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
    missing_required_fee_lines: Array.isArray(row.missing_required_fee_lines)
      ? row.missing_required_fee_lines
      : [],
    unit_name: asString(row.unit_name).trim() || null,
    property_name: asString(row.property_name).trim() || null,
    summary: asString(row.summary).trim() || null,
    description: asString(row.description).trim() || null,
    property_id: asString(row.property_id).trim() || null,
    unit_id: asString(row.unit_id).trim() || null,
    pricing_template_id: asString(row.pricing_template_id).trim() || null,
    application_count: asNumber(row.application_count),
    active_lease_count: asNumber(row.active_lease_count),
    readiness_score: asNumber(row.readiness_score),
    readiness_blocking: Array.isArray(row.readiness_blocking)
      ? row.readiness_blocking.map(String)
      : [],
  };
}

/* ---------- component ---------- */

const NUMERIC_FIELDS = new Set(["bedrooms", "bathrooms", "square_meters"]);

export function ListingsManager({
  orgId,
  pricingTemplates,
  properties,
  units,
}: {
  orgId: string;
  pricingTemplates: Record<string, unknown>[];
  properties: Record<string, unknown>[];
  units: Record<string, unknown>[];
}) {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const queryClient = useQueryClient();

  /* --- server-side paginated data --- */
  const query = useListingsQuery(orgId);

  /* --- sheet state --- */
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ListingRow | null>(null);

  /* --- selection --- */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkProcessing, setBulkProcessing] = useState(false);

  /* --- preview --- */
  const [previewListing, setPreviewListing] = useState<ListingRow | null>(
    null
  );

  /* --- scroll-to-field (Make Ready) --- */
  const [scrollToField, setScrollToField] = useState<string | undefined>();

  /* --- saved views --- */
  const [activeViewId, setActiveViewId] = useState<string | null>("all");

  const handleApplyView = useCallback(
    (view: SavedView) => {
      query.applyView(view);
      setActiveViewId(view.id);
    },
    [query]
  );

  /* --- convert API rows --- */
  const rows = useMemo<ListingRow[]>(() => {
    if (!query.data?.data) return [];
    return query.data.data.map(toListingRow);
  }, [query.data]);

  /* --- reference data for form --- */
  const pricingTemplateOptions = useMemo(() => {
    return pricingTemplates
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return { id, label: asString(row.name).trim() || id };
      })
      .filter((row): row is { id: string; label: string } => Boolean(row));
  }, [pricingTemplates]);

  const propertyOptions = useMemo(() => {
    return properties
      .map((row) => {
        const id = asString(row.id).trim();
        if (!id) return null;
        return { id, label: asString(row.name).trim() || id };
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

  /* --- callbacks --- */

  const openCreate = useCallback(() => {
    setEditing(null);
    setOpen(true);
  }, []);

  const openEdit = useCallback((row: ListingRow) => {
    setScrollToField(undefined);
    setEditing(row);
    setOpen(true);
  }, []);

  const handleMakeReady = useCallback((row: ListingRow) => {
    const firstBlocking = row.readiness_blocking[0] ?? undefined;
    setScrollToField(firstBlocking);
    setEditing(row);
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

  const toggleSelectAll = useCallback((pageIds: string[]) => {
    setSelectedIds((prev) => {
      const allSelected = pageIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
  }, []);

  const handlePublish = useCallback(
    async (listingId: string) => {
      try {
        await authedFetch(
          `/listings/${encodeURIComponent(listingId)}/publish`,
          { method: "POST", body: "{}" }
        );
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        toast.success(isEn ? "Published" : "Publicado");
      } catch (err) {
        toast.error(isEn ? "Failed" : "Error", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [queryClient, isEn]
  );

  const handleUnpublish = useCallback(
    async (listingId: string) => {
      try {
        await authedFetch(
          `/listings/${encodeURIComponent(listingId)}`,
          { method: "PATCH", body: JSON.stringify({ is_published: false }) }
        );
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        toast.success(isEn ? "Unpublished" : "Despublicado");
      } catch (err) {
        toast.error(isEn ? "Failed" : "Error", {
          description: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [queryClient, isEn]
  );

  const handleCommitEdit = useCallback(
    async (
      listingId: string,
      field: string,
      value: string
    ): Promise<{ ok: boolean; error?: string }> => {
      const apiValue = NUMERIC_FIELDS.has(field)
        ? Number(value) || 0
        : value;
      try {
        await authedFetch(
          `/listings/${encodeURIComponent(listingId)}`,
          { method: "PATCH", body: JSON.stringify({ [field]: apiValue }) }
        );
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    [queryClient]
  );

  const bulkAction = useCallback(
    async (action: "publish" | "unpublish") => {
      if (selectedIds.size === 0) return;
      setBulkProcessing(true);
      try {
        for (const id of selectedIds) {
          if (action === "publish") {
            await authedFetch(
              `/listings/${encodeURIComponent(id)}/publish`,
              { method: "POST", body: "{}" }
            );
          } else {
            await authedFetch(
              `/listings/${encodeURIComponent(id)}`,
              {
                method: "PATCH",
                body: JSON.stringify({ is_published: false }),
              }
            );
          }
        }
        queryClient.invalidateQueries({ queryKey: ["listings"] });
        toast.success(isEn ? "Done" : "Hecho");
      } catch {
        toast.error(isEn ? "Failed" : "Error");
      } finally {
        setBulkProcessing(false);
        setSelectedIds(new Set());
      }
    },
    [selectedIds, queryClient, isEn]
  );

  const isEditing = editing !== null;

  return (
    <div className="space-y-4">
      {/* ---- action bar ---- */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {selectedIds.size > 0 ? (
          <p className="mr-auto text-muted-foreground text-sm">
            {selectedIds.size} {isEn ? "selected" : "seleccionados"}
          </p>
        ) : null}
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

      {/* ---- table ---- */}
      <ListingNotionTable
        formatLocale={locale as "en-US" | "es-PY"}
        globalFilter={query.globalFilter}
        isEn={isEn}
        isLoading={query.isLoading}
        onCommitEdit={handleCommitEdit}
        onEditInSheet={openEdit}
        onGlobalFilterChange={query.setGlobalFilter}
        onMakeReady={handleMakeReady}
        onPaginationChange={query.setPagination}
        onPreview={setPreviewListing}
        onPublish={handlePublish}
        onReadinessFilterChange={query.setReadinessFilter}
        onSortingChange={query.setSorting}
        onStatusFilterChange={query.setStatusFilter}
        onToggleSelect={toggleSelect}
        onToggleSelectAll={toggleSelectAll}
        onUnpublish={handleUnpublish}
        pageCount={query.pageCount}
        pagination={query.pagination}
        readinessFilter={query.readinessFilter}
        rows={rows}
        selectedIds={selectedIds}
        sorting={query.sorting}
        statusFilter={query.statusFilter}
        totalRows={query.totalRows}
        activeViewId={activeViewId}
        onApplyView={handleApplyView}
      />

      {/* ---- form sheet ---- */}
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
          if (!next) setEditing(null);
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
        <ListingForm
          editing={editing}
          isEn={isEn}
          key={editing?.id ?? "create"}
          locale={locale}
          scrollToField={scrollToField}
          onPreview={
            editing
              ? () => {
                  setOpen(false);
                  setPreviewListing(editing);
                }
              : undefined
          }
          onSuccess={() => {
            setOpen(false);
            setEditing(null);
          }}
          orgId={orgId}
          pricingTemplateOptions={pricingTemplateOptions}
          propertyOptions={propertyOptions}
          unitOptions={unitOptions}
        />
      </Sheet>

      {/* ---- preview modal ---- */}
      {previewListing ? (
        <ListingPreviewModal
          isEn={isEn}
          isPublished={previewListing.is_published}
          listingId={previewListing.id}
          locale={locale as Locale}
          onClose={() => setPreviewListing(null)}
          slug={previewListing.public_slug}
        />
      ) : null}
    </div>
  );
}
