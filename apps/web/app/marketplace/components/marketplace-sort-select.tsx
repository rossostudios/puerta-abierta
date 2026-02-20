"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";

const SORT_OPTIONS = [
  { value: "featured", en: "Featured", es: "Destacados" },
  { value: "newest", en: "Newest", es: "Más nuevos" },
  { value: "move_in_desc", en: "Move-in: Furthest", es: "Ingreso: Lejano" },
  { value: "move_in_asc", en: "Move-in: Soonest", es: "Ingreso: Pronto" },
  {
    value: "monthly_desc",
    en: "Price: High to Low",
    es: "Precio: Mayor a Menor",
  },
  {
    value: "monthly_asc",
    en: "Price: Low to High",
    es: "Precio: Menor a Mayor",
  },
] as const;

export function MarketplaceSortSelect({
  isEn,
  value,
}: { isEn: boolean; value: string }) {
  return (
    <Suspense
      fallback={
        <div className="h-8 w-32 animate-pulse rounded-full bg-muted" />
      }
    >
      <SortSelectInner isEn={isEn} value={value} />
    </Suspense>
  );
}

function SortSelectInner({
  isEn,
  value,
}: { isEn: boolean; value: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const params = new URLSearchParams(searchParams.toString());
      const next = e.target.value;

      if (next === "featured") {
        params.delete("sort");
      } else {
        params.set("sort", next);
      }

      const query = params.toString();
      router.replace(`/marketplace${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  return (
    <div className="flex flex-none items-center gap-2 font-semibold text-[var(--marketplace-text-muted)] text-xs">
      <span>{isEn ? "Sort by" : "Ordenar"}:</span>
      <select
        className="cursor-pointer appearance-none rounded-full border border-[#e8e4df] bg-[var(--marketplace-bg-muted)] px-4 py-2 font-semibold text-[var(--marketplace-text)] text-xs outline-none transition-colors hover:bg-black/5"
        onChange={handleChange}
        value={value}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {isEn ? opt.en : opt.es}
          </option>
        ))}
      </select>
    </div>
  );
}
