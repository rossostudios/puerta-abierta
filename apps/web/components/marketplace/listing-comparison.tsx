"use client";

import {
  Cancel01Icon,
  CheckmarkSquare01Icon,
  SquareIcon,
} from "@hugeicons/core-free-icons";
import Image from "next/image";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import {
  asNumber,
  asOptionalNumber,
  asText,
  type MarketplaceListingRecord,
} from "./marketplace-types";

type ComparisonProps = {
  selected: MarketplaceListingRecord[];
  onRemove: (id: string) => void;
  onClear: () => void;
  isEn: boolean;
  locale: "es-PY" | "en-US";
};

function ComparisonModal({
  selected,
  onRemove,
  onClear,
  isEn,
  locale,
}: ComparisonProps & { onClose: () => void }) {
  const currency = (listing: MarketplaceListingRecord) =>
    asText(listing.currency) || "PYG";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold font-serif text-[var(--marketplace-text)] text-lg">
            {isEn ? "Compare Listings" : "Comparar Anuncios"}
          </h2>
          <button
            className="rounded-lg p-1 text-gray-400 hover:text-gray-600"
            onClick={onClear}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={20} />
          </button>
        </div>

        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: `repeat(${selected.length}, 1fr)` }}
        >
          {/* biome-ignore lint/complexity/noExcessiveCognitiveComplexity: each card intentionally inlines field extraction and formatting for readability. */}
          {selected.map((listing) => {
            const id = asText(listing.id);
            const title =
              asText(listing.title) || (isEn ? "Untitled" : "Sin titulo");
            const cover = asText(listing.cover_image_url);
            const bedrooms = asOptionalNumber(listing.bedrooms);
            const bathrooms = asOptionalNumber(listing.bathrooms);
            const sqm = asOptionalNumber(listing.square_meters);
            const monthly = asNumber(listing.monthly_recurring_total);
            const moveIn = asNumber(listing.total_move_in);
            const neighborhood = asText(listing.neighborhood);
            const city = asText(listing.city);
            const amenities = Array.isArray(listing.amenities)
              ? (listing.amenities as string[])
              : [];
            const petPolicy = asText(listing.pet_policy);
            const furnished =
              listing.furnished === true || listing.furnished === "true";

            return (
              <div className="space-y-3" key={id}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-gray-100">
                  {cover ? (
                    <Image
                      alt={title}
                      className="object-cover"
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      src={cover}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-gray-400 text-xs">
                      {isEn ? "No image" : "Sin imagen"}
                    </div>
                  )}
                  <button
                    className="absolute top-2 right-2 rounded-full bg-white/80 p-1"
                    onClick={() => onRemove(id)}
                    type="button"
                  >
                    <Icon icon={Cancel01Icon} size={14} />
                  </button>
                </div>

                <h3 className="font-semibold text-sm">{title}</h3>
                <p className="text-gray-500 text-xs">
                  {neighborhood ? `${neighborhood}, ${city}` : city}
                </p>

                <div className="space-y-1 rounded-lg bg-gray-50 p-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">
                      {isEn ? "Monthly" : "Mensual"}
                    </span>
                    <span className="font-semibold">
                      {formatCurrency(monthly, currency(listing), locale)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">
                      {isEn ? "Move-in" : "Ingreso"}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(moveIn, currency(listing), locale)}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {isEn ? "Bedrooms" : "Habitaciones"}
                    </span>
                    <span>{bedrooms ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {isEn ? "Bathrooms" : "Banos"}
                    </span>
                    <span>{bathrooms ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">m²</span>
                    <span>{sqm ?? "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {isEn ? "Furnished" : "Amoblado"}
                    </span>
                    <span>{furnished ? (isEn ? "Yes" : "Si") : "No"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {isEn ? "Pets" : "Mascotas"}
                    </span>
                    <span>{petPolicy || "-"}</span>
                  </div>
                </div>

                {amenities.length > 0 ? (
                  <div>
                    <p className="mb-1 font-medium text-gray-500 text-xs">
                      {isEn ? "Amenities" : "Amenidades"}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {amenities.slice(0, 6).map((a) => (
                        <span
                          className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px]"
                          key={a}
                        >
                          {a}
                        </span>
                      ))}
                      {amenities.length > 6 ? (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px]">
                          +{amenities.length - 6}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function useListingComparison() {
  const [selected, setSelected] = useState<MarketplaceListingRecord[]>([]);

  const toggle = (listing: MarketplaceListingRecord) => {
    const id = asText(listing.id);
    setSelected((prev) => {
      const exists = prev.some((l) => asText(l.id) === id);
      if (exists) return prev.filter((l) => asText(l.id) !== id);
      if (prev.length >= 3) return prev;
      return [...prev, listing];
    });
  };

  const remove = (id: string) => {
    setSelected((prev) => prev.filter((l) => asText(l.id) !== id));
  };

  const clear = () => setSelected([]);

  const isSelected = (listing: MarketplaceListingRecord) =>
    selected.some((l) => asText(l.id) === asText(listing.id));

  return { selected, toggle, remove, clear, isSelected };
}

export function CompareCheckbox({
  listing,
  isSelected,
  onToggle,
  isEn,
}: {
  listing: MarketplaceListingRecord;
  isSelected: boolean;
  onToggle: (listing: MarketplaceListingRecord) => void;
  isEn: boolean;
}) {
  return (
    <button
      className="inline-flex items-center gap-1 rounded-lg border border-[#e8e4df] bg-white/80 px-2 py-1 font-medium text-[10px] backdrop-blur transition-colors hover:bg-white"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle(listing);
      }}
      type="button"
    >
      <Icon icon={isSelected ? CheckmarkSquare01Icon : SquareIcon} size={13} />
      {isEn ? "Compare" : "Comparar"}
    </button>
  );
}

export function ComparisonBar({
  selected,
  onRemove,
  onClear,
  isEn,
  locale,
}: ComparisonProps) {
  const [showModal, setShowModal] = useState(false);

  if (selected.length < 2) return null;

  return (
    <>
      <div className="fixed right-0 bottom-0 left-0 z-40 border-[#e8e4df] border-t bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="font-medium text-[var(--marketplace-text)] text-sm">
              {selected.length} {isEn ? "selected" : "seleccionados"}
            </span>
            <div className="flex -space-x-2">
              {selected.map((listing) => {
                const cover = asText(listing.cover_image_url);
                return cover ? (
                  <div
                    className="h-8 w-8 overflow-hidden rounded-full border-2 border-white"
                    key={asText(listing.id)}
                  >
                    <Image
                      alt=""
                      className="object-cover"
                      height={32}
                      src={cover}
                      width={32}
                    />
                  </div>
                ) : null;
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={onClear} size="sm" variant="ghost">
              {isEn ? "Clear" : "Limpiar"}
            </Button>
            <Button onClick={() => setShowModal(true)} size="sm">
              {isEn ? "Compare" : "Comparar"}
            </Button>
          </div>
        </div>
      </div>

      {showModal ? (
        <ComparisonModal
          isEn={isEn}
          locale={locale}
          onClear={() => {
            onClear();
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
          onRemove={onRemove}
          selected={selected}
        />
      ) : null}
    </>
  );
}
