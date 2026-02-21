"use client";

import {
  Bookmark01Icon,
  Cancel01Icon,
  FilterIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import type { VisibilityState } from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  deleteCustomView,
  getCustomViews,
  PRESET_VIEWS,
  PRESET_VIEWS_ES,
  type SavedView,
  saveCustomView,
} from "@/lib/features/listings/saved-views";
import { cn } from "@/lib/utils";

export type ListingStatusFilter = "all" | "published" | "draft";
export type ListingReadinessFilter =
  | "all"
  | "ready"
  | "incomplete"
  | "not_ready";

const TOGGLEABLE_COLUMNS: { id: string; en: string; es: string }[] = [
  { id: "city", en: "City", es: "Ciudad" },
  { id: "property_type", en: "Type", es: "Tipo" },
  { id: "bedrooms", en: "Bedrooms", es: "Habitaciones" },
  { id: "bathrooms", en: "Bathrooms", es: "Baños" },
  { id: "square_meters", en: "Area (m²)", es: "Área (m²)" },
  { id: "monthly_recurring_total", en: "Monthly", es: "Mensual" },
  { id: "readiness", en: "Readiness", es: "Preparación" },
  { id: "pipeline", en: "Pipeline", es: "Pipeline" },
];

type ListingsFilterBarProps = {
  globalFilter: string;
  onGlobalFilterChange: (value: string) => void;
  statusFilter: ListingStatusFilter;
  onStatusFilterChange: (value: ListingStatusFilter) => void;
  readinessFilter: ListingReadinessFilter;
  onReadinessFilterChange: (value: ListingReadinessFilter) => void;
  isEn: boolean;
  activeViewId?: string | null;
  onApplyView?: (view: SavedView) => void;
  sorting?: { id: string; desc: boolean }[];
  columnVisibility?: VisibilityState;
  responsiveDefaults?: VisibilityState;
  onToggleColumn?: (colId: string) => void;
};

export function ListingsFilterBar({
  globalFilter,
  onGlobalFilterChange,
  statusFilter,
  onStatusFilterChange,
  readinessFilter,
  onReadinessFilterChange,
  isEn,
  activeViewId,
  onApplyView,
  sorting,
  columnVisibility,
  responsiveDefaults,
  onToggleColumn,
}: ListingsFilterBarProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [customViews, setCustomViews] = useState<SavedView[]>(() =>
    getCustomViews()
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleGlobalFilterInput = (nextValue: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onGlobalFilterChange(nextValue);
    }, 300);
  };

  const activeCount =
    (statusFilter !== "all" ? 1 : 0) + (readinessFilter !== "all" ? 1 : 0);

  const allViews = [...PRESET_VIEWS, ...customViews];

  function handleSaveView() {
    const nameParts: string[] = [];
    if (statusFilter !== "all") nameParts.push(statusFilter);
    if (readinessFilter !== "all") nameParts.push(readinessFilter);
    if (globalFilter.trim()) nameParts.push(globalFilter.trim());
    const fallbackName = isEn
      ? `View ${customViews.length + 1}`
      : `Vista ${customViews.length + 1}`;
    const name =
      nameParts.length > 0 ? nameParts.join(" · ").slice(0, 60) : fallbackName;
    const view = saveCustomView({
      name,
      globalFilter,
      statusFilter,
      readinessFilter,
      sorting: sorting ?? [{ id: "created_at", desc: true }],
    });
    setCustomViews((prev) => [...prev, view]);
    onApplyView?.(view);
  }

  function handleDeleteView(id: string) {
    deleteCustomView(id);
    setCustomViews((prev) => prev.filter((v) => v.id !== id));
  }

  return (
    <div className="space-y-2">
      {onApplyView ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {allViews.map((view) => (
            <div className="group relative" key={view.id}>
              <button
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 font-medium text-xs transition-colors",
                  activeViewId === view.id
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-border/50 bg-background/80 text-muted-foreground hover:bg-muted"
                )}
                onClick={() => onApplyView(view)}
                type="button"
              >
                {view.preset
                  ? isEn
                    ? view.name
                    : (PRESET_VIEWS_ES[view.id] ?? view.name)
                  : view.name}
              </button>
              {view.preset ? null : (
                <button
                  className="absolute -top-1 -right-1 hidden h-4 w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground group-hover:flex"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteView(view.id);
                  }}
                  type="button"
                >
                  <Icon icon={Cancel01Icon} size={8} />
                </button>
              )}
            </div>
          ))}
          <button
            className="inline-flex items-center gap-1 rounded-full border border-border/50 border-dashed px-2.5 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted"
            onClick={handleSaveView}
            type="button"
          >
            <Icon icon={Bookmark01Icon} size={11} />
            {isEn ? "Save view" : "Guardar vista"}
          </button>
        </div>
      ) : null}

      <div className="glass-inner flex flex-wrap items-center gap-3 rounded-2xl p-2">
        <div className="relative min-w-[14rem] flex-1">
          <Icon
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            icon={Search01Icon}
            size={15}
          />
          <Input
            className="h-10 rounded-xl border-border/50 bg-background/80 pl-10 focus-visible:ring-primary/20"
            defaultValue={globalFilter}
            key={globalFilter}
            onChange={(e) => handleGlobalFilterInput(e.target.value)}
            placeholder={
              isEn
                ? "Search by title, city, property..."
                : "Buscar por título, ciudad, propiedad..."
            }
          />
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              className="h-10 gap-2 rounded-xl border-border/60 font-semibold text-muted-foreground hover:bg-muted"
              size="sm"
              variant="outline"
            >
              <Icon icon={FilterIcon} size={15} />
              {isEn ? "Filters" : "Filtros"}
              {activeCount > 0 ? (
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary font-bold text-[10px] text-primary-foreground">
                  {activeCount}
                </div>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem] rounded-xl">
            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              {isEn ? "Status" : "Estado"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                statusFilter === "all" && "bg-muted"
              )}
              onClick={() => onStatusFilterChange("all")}
            >
              {isEn ? "All statuses" : "Todos los estados"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                statusFilter === "published" && "bg-muted"
              )}
              onClick={() => onStatusFilterChange("published")}
            >
              {isEn ? "Published" : "Publicados"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                statusFilter === "draft" && "bg-muted"
              )}
              onClick={() => onStatusFilterChange("draft")}
            >
              {isEn ? "Draft" : "Borrador"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              {isEn ? "Readiness" : "Preparación"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                readinessFilter === "all" && "bg-muted"
              )}
              onClick={() => onReadinessFilterChange("all")}
            >
              {isEn ? "All" : "Todos"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                readinessFilter === "ready" && "bg-muted"
              )}
              onClick={() => onReadinessFilterChange("ready")}
            >
              {isEn ? "Ready" : "Listo"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                readinessFilter === "incomplete" && "bg-muted"
              )}
              onClick={() => onReadinessFilterChange("incomplete")}
            >
              {isEn ? "Incomplete" : "Incompleto"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                readinessFilter === "not_ready" && "bg-muted"
              )}
              onClick={() => onReadinessFilterChange("not_ready")}
            >
              {isEn ? "Not ready" : "No listo"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {onToggleColumn && columnVisibility ? (
          <PopoverRoot>
            <PopoverTrigger>
              <Button
                className="h-10 gap-2 rounded-xl border-border/60 font-semibold text-muted-foreground hover:bg-muted"
                size="sm"
                variant="outline"
              >
                <Icon icon={SlidersHorizontalIcon} size={15} />
                {isEn ? "Columns" : "Columnas"}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[200px] p-2">
              {TOGGLEABLE_COLUMNS.map((col) => {
                const visible = columnVisibility[col.id] !== false;
                const responsiveHidden = responsiveDefaults?.[col.id] === false;
                return (
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted",
                      responsiveHidden && "pointer-events-none opacity-40"
                    )}
                    key={col.id}
                  >
                    <Checkbox
                      checked={visible}
                      disabled={responsiveHidden}
                      onCheckedChange={() => onToggleColumn(col.id)}
                    />
                    <span>{isEn ? col.en : col.es}</span>
                  </label>
                );
              })}
            </PopoverContent>
          </PopoverRoot>
        ) : null}
      </div>
    </div>
  );
}
