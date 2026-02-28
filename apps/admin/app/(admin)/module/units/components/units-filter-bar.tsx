import {
  ChartIcon,
  FilterIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
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
import type {
  UnitBedroomFilter,
  UnitStatusFilter,
  UnitViewMode,
} from "@/lib/features/units/types";
import { cn } from "@/lib/utils";

type UnitsFilterBarProps = {
  isEn: boolean;
  query: string;
  propertyFilter: string;
  statusFilter: UnitStatusFilter;
  bedroomFilter: UnitBedroomFilter;
  viewMode: UnitViewMode;
  propertyOptions: { id: string; label: string }[];
  bedroomOptions: number[];
  onQueryChange: (value: string) => void;
  onPropertyFilterChange: (value: string) => void;
  onStatusFilterChange: (value: UnitStatusFilter) => void;
  onBedroomFilterChange: (value: UnitBedroomFilter) => void;
  onViewModeChange: (value: UnitViewMode) => void;
};

export function UnitsFilterBar({
  isEn,
  query,
  propertyFilter,
  statusFilter,
  bedroomFilter,
  viewMode,
  propertyOptions,
  bedroomOptions,
  onQueryChange,
  onPropertyFilterChange,
  onStatusFilterChange,
  onBedroomFilterChange,
  onViewModeChange,
}: UnitsFilterBarProps) {
  const activeFilterCount =
    (propertyFilter !== "all" ? 1 : 0) +
    (statusFilter !== "all" ? 1 : 0) +
    (bedroomFilter !== "all" ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-full border border-border/40 bg-card/40 p-1.5 pl-4 shadow-sm backdrop-blur-md">
      <div className="relative min-w-[20rem] flex-1">
        <Icon
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
          icon={Search01Icon}
          size={15}
        />
        <Input
          className="h-10 border-0 bg-transparent pl-10 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={
            isEn
              ? "Search by name, code or property..."
              : "Buscar por nombre, código o propiedad..."
          }
          value={query}
        />
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                className="h-10 rounded-full border border-border/40 bg-background/50 text-muted-foreground shadow-sm transition-all hover:bg-background/80"
                size="sm"
                variant="outline"
              />
            }
          >
            <Icon icon={FilterIcon} size={15} />
            {isEn ? "Filters" : "Filtros"}
            {activeFilterCount > 0 ? (
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary font-bold text-[10px] text-primary-foreground">
                {activeFilterCount}
              </div>
            ) : null}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[12rem] rounded-xl">
            {/* Property filter */}
            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              {isEn ? "Property" : "Propiedad"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                propertyFilter === "all" && "bg-muted"
              )}
              onClick={() => onPropertyFilterChange("all")}
            >
              {isEn ? "All properties" : "Todas las propiedades"}
            </DropdownMenuItem>
            {propertyOptions.map((property) => (
              <DropdownMenuItem
                className={cn(
                  "m-1 rounded-lg",
                  propertyFilter === property.id && "bg-muted"
                )}
                key={property.id}
                onClick={() => onPropertyFilterChange(property.id)}
              >
                {property.label}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            {/* Status filter */}
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
                statusFilter === "active" && "bg-muted"
              )}
              onClick={() => onStatusFilterChange("active")}
            >
              {isEn ? "Active" : "Activas"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                statusFilter === "inactive" && "bg-muted"
              )}
              onClick={() => onStatusFilterChange("inactive")}
            >
              {isEn ? "Inactive" : "Inactivas"}
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Bedrooms filter */}
            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              {isEn ? "Bedrooms" : "Dormitorios"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                bedroomFilter === "all" && "bg-muted"
              )}
              onClick={() => onBedroomFilterChange("all")}
            >
              {isEn ? "All bedrooms" : "Todos los dormitorios"}
            </DropdownMenuItem>
            {bedroomOptions.map((count) => (
              <DropdownMenuItem
                className={cn(
                  "m-1 rounded-lg",
                  bedroomFilter === count && "bg-muted"
                )}
                key={count}
                onClick={() => onBedroomFilterChange(count)}
              >
                {count}{" "}
                {isEn
                  ? count === 1
                    ? "bedroom"
                    : "bedrooms"
                  : count === 1
                    ? "dormitorio"
                    : "dormitorios"}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-1 hidden h-6 w-px bg-border/40 sm:block" />

        <div className="inline-flex items-center gap-1 rounded-full border border-border/40 bg-background/50 p-1 shadow-sm">
          <Button
            className="h-8 w-8 rounded-full p-0 transition-all"
            onClick={() => onViewModeChange("table")}
            size="sm"
            variant={viewMode === "table" ? "secondary" : "ghost"}
          >
            <Icon icon={ChartIcon} size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}
