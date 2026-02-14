"use client";

import {
  Building06Icon,
  Clock01Icon,
  Door01Icon,
  GridViewIcon,
  HeartCheckIcon,
  Home01Icon,
  Sofa01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type Category = {
  key: string;
  label: { "en-US": string; "es-PY": string };
  icon: IconSvgElement;
  params: Record<string, string>;
};

const CATEGORIES: readonly Category[] = [
  {
    key: "all",
    label: { "en-US": "All", "es-PY": "Todos" },
    icon: GridViewIcon,
    params: {},
  },
  {
    key: "available-now",
    label: { "en-US": "Available now", "es-PY": "Disponible ya" },
    icon: Clock01Icon,
    params: { available_now: "true" },
  },
  {
    key: "apartment",
    label: { "en-US": "Apartments", "es-PY": "Departamentos" },
    icon: Building06Icon,
    params: { property_type: "apartment" },
  },
  {
    key: "house",
    label: { "en-US": "Houses", "es-PY": "Casas" },
    icon: Home01Icon,
    params: { property_type: "house" },
  },
  {
    key: "studio",
    label: { "en-US": "Studios", "es-PY": "Monoambientes" },
    icon: Door01Icon,
    params: { property_type: "studio" },
  },
  {
    key: "furnished",
    label: { "en-US": "Furnished", "es-PY": "Amoblados" },
    icon: Sofa01Icon,
    params: { furnished: "true" },
  },
  {
    key: "pet-friendly",
    label: { "en-US": "Pet-Friendly", "es-PY": "Acepta mascotas" },
    icon: HeartCheckIcon,
    params: { pet_policy: "allowed" },
  },
];

function resolveActiveKey(searchParams: URLSearchParams): string {
  const propertyType = searchParams.get("property_type") || "";
  const furnished = searchParams.get("furnished") || "";
  const petPolicy = searchParams.get("pet_policy") || "";
  const availableNow = searchParams.get("available_now") || "";

  if (availableNow === "true") return "available-now";
  if (petPolicy) return "pet-friendly";
  if (furnished === "true") return "furnished";
  if (propertyType === "apartment") return "apartment";
  if (propertyType === "house") return "house";
  if (propertyType === "studio") return "studio";
  return "all";
}

export function CategoryPills({ locale }: { locale: "es-PY" | "en-US" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeKey = resolveActiveKey(searchParams);

  const handleClick = useCallback(
    (category: Category) => {
      const params = new URLSearchParams(searchParams.toString());

      // Clear category-related params
      params.delete("property_type");
      params.delete("furnished");
      params.delete("pet_policy");
      params.delete("available_now");

      // Apply new category params
      for (const [key, value] of Object.entries(category.params)) {
        params.set(key, value);
      }

      const query = params.toString();
      router.replace(`/marketplace${query ? `?${query}` : ""}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  return (
    <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {CATEGORIES.map((category) => {
        const active = activeKey === category.key;
        return (
          <button
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 font-medium text-sm transition-colors",
              active
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border/80 bg-card/90 text-muted-foreground hover:border-border hover:text-foreground"
            )}
            key={category.key}
            onClick={() => handleClick(category)}
            type="button"
          >
            <Icon icon={category.icon} size={15} />
            {category.label[locale]}
          </button>
        );
      })}
    </div>
  );
}
