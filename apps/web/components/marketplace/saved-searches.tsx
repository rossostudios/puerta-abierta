"use client";

import { Cancel01Icon, FloppyDiskIcon } from "@hugeicons/core-free-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

type SavedSearch = {
  id: string;
  name: string;
  filters: Record<string, string>;
};

function buildSearchName(
  params: Record<string, string>,
  isEn: boolean,
  nextIndex: number
): string {
  const query = params.q?.trim();
  if (query) return query;
  const city = params.city?.trim();
  if (city) {
    return isEn ? `${city} rentals` : `Alquileres en ${city}`;
  }
  return isEn ? `Saved search ${nextIndex}` : `Busqueda guardada ${nextIndex}`;
}

function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("casaora_visitor_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("casaora_visitor_id", id);
  }
  return id;
}

export function SavedSearches({ isEn }: { isEn: boolean }) {
  return (
    <Suspense fallback={null}>
      <SavedSearchesInner isEn={isEn} />
    </Suspense>
  );
}

function SavedSearchesInner({ isEn }: { isEn: boolean }) {
  "use no memo";
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);

  const visitorId = typeof window !== "undefined" ? getVisitorId() : "";

  const { data: searches = [], isPending: loading } = useQuery({
    queryKey: ["saved-searches", visitorId],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/public/saved-searches?visitor_id=${encodeURIComponent(visitorId)}`
      );
      if (!res.ok) return [];
      const data = (await res.json()) as { data?: SavedSearch[] };
      return data.data ?? [];
    },
    enabled: !!visitorId,
  });

  const saveCurrentSearch = async () => {
    const params = Object.fromEntries(searchParams.entries());
    const activeKeys = Object.keys(params).filter(
      (k) => k !== "page" && params[k]
    );
    if (activeKeys.length === 0) return;

    const name = buildSearchName(params, isEn, searches.length + 1);

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/public/saved-searches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_id: visitorId,
          name: name.trim(),
          filters: params,
        }),
      });
      if (res.ok) {
        await queryClient.invalidateQueries({
          queryKey: ["saved-searches", visitorId],
        });
      }
      setSaving(false);
    } catch {
      setSaving(false);
    }
  };

  const deleteSearch = async (id: string) => {
    try {
      await fetch(`${API_BASE}/public/saved-searches`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor_id: visitorId, id }),
      });
      queryClient.setQueryData(
        ["saved-searches", visitorId],
        (prev: SavedSearch[] | undefined) =>
          prev ? prev.filter((s) => s.id !== id) : []
      );
    } catch {
      // silently fail
    }
  };

  const applySearch = (filters: Record<string, string>) => {
    const params = new URLSearchParams(filters);
    router.push(`/marketplace?${params.toString()}`);
  };

  const hasActiveFilters = Array.from(searchParams.entries()).some(
    ([k, v]) => k !== "page" && v
  );

  if (loading && searches.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {searches.map((search) => (
        <div
          className="group inline-flex items-center gap-1.5 rounded-full border border-[#e8e4df] bg-white px-3 py-1.5 font-medium text-[var(--marketplace-text)] text-xs transition-colors hover:border-primary/30 hover:bg-primary/5"
          key={search.id}
        >
          <button onClick={() => applySearch(search.filters)} type="button">
            {search.name}
          </button>
          <button
            className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => deleteSearch(search.id)}
            type="button"
          >
            <Icon
              className="text-muted-foreground"
              icon={Cancel01Icon}
              size={12}
            />
          </button>
        </div>
      ))}

      {hasActiveFilters ? (
        <Button
          className="h-7 rounded-full px-3 text-xs"
          disabled={saving}
          onClick={saveCurrentSearch}
          size="sm"
          variant="outline"
        >
          <Icon className="mr-1" icon={FloppyDiskIcon} size={13} />
          {saving
            ? isEn
              ? "Saving..."
              : "Guardando..."
            : isEn
              ? "Save search"
              : "Guardar busqueda"}
        </Button>
      ) : null}
    </div>
  );
}
