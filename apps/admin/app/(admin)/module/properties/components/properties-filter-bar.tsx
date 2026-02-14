import {
  ChartIcon,
  FilterIcon,
  GridViewIcon,
  MapsLocation01Icon,
  Search01Icon,
  SidebarRight01Icon,
} from "@hugeicons/core-free-icons";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import type {
  PropertyHealthFilter,
  PropertyStatusFilter,
  PropertyViewMode,
} from "@/lib/features/properties/types";
import { cn } from "@/lib/utils";

type PropertiesFilterBarProps = {
  isEn: boolean;
  query: string;
  statusFilter: PropertyStatusFilter;
  healthFilter: PropertyHealthFilter;
  viewMode: PropertyViewMode;
  isSidebarOpen: boolean;
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: PropertyStatusFilter) => void;
  onHealthFilterChange: (value: PropertyHealthFilter) => void;
  onViewModeChange: (value: PropertyViewMode) => void;
  onToggleSidebar: () => void;
};

export function PropertiesFilterBar({
  isEn,
  query,
  statusFilter,
  healthFilter,
  viewMode,
  isSidebarOpen,
  onQueryChange,
  onStatusFilterChange,
  onHealthFilterChange,
  onViewModeChange,
  onToggleSidebar,
}: PropertiesFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card/30 p-2 shadow-sm backdrop-blur-sm">
      <div className="relative min-w-[20rem] flex-1">
        <Icon
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          icon={Search01Icon}
          size={15}
        />
        <Input
          className="h-10 rounded-xl border-border/50 bg-background/80 pl-10 focus-visible:ring-primary/20"
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={
            isEn
              ? "Search by name, address or code..."
              : "Buscar por nombre, dirección o código..."
          }
          value={query}
        />
      </div>

      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button
              className="h-10 gap-2 rounded-xl border-border/60 font-semibold text-muted-foreground hover:bg-muted"
              size="sm"
              variant="outline"
            >
              <Icon icon={FilterIcon} size={15} />
              {isEn ? "Filters" : "Filtros"}
              {statusFilter !== "all" || healthFilter !== "all" ? (
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-primary font-bold text-[10px] text-primary-foreground">
                  {(statusFilter !== "all" ? 1 : 0) +
                    (healthFilter !== "all" ? 1 : 0)}
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

            <DropdownMenuLabel className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">
              {isEn ? "Health" : "Riesgo"}
            </DropdownMenuLabel>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                healthFilter === "all" && "bg-muted"
              )}
              onClick={() => onHealthFilterChange("all")}
            >
              {isEn ? "All health states" : "Todos los estados"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                healthFilter === "stable" && "bg-muted"
              )}
              onClick={() => onHealthFilterChange("stable")}
            >
              {isEn ? "Stable" : "Estable"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                healthFilter === "watch" && "bg-muted"
              )}
              onClick={() => onHealthFilterChange("watch")}
            >
              {isEn ? "Watch" : "Seguimiento"}
            </DropdownMenuItem>
            <DropdownMenuItem
              className={cn(
                "m-1 rounded-lg",
                healthFilter === "critical" && "bg-muted"
              )}
              onClick={() => onHealthFilterChange("critical")}
            >
              {isEn ? "Critical" : "Crítico"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mx-1 hidden h-6 w-px bg-border/40 sm:block" />

        <div className="inline-flex items-center gap-1 rounded-xl border border-border/40 bg-background/40 p-1">
          <Button
            className="h-8 w-8 rounded-lg p-0 transition-all"
            onClick={() => onViewModeChange("grid")}
            size="sm"
            variant={viewMode === "grid" ? "secondary" : "ghost"}
          >
            <Icon icon={GridViewIcon} size={14} />
          </Button>
          <Button
            className="h-8 w-8 rounded-lg p-0 transition-all"
            onClick={() => onViewModeChange("table")}
            size="sm"
            variant={viewMode === "table" ? "secondary" : "ghost"}
          >
            <Icon icon={ChartIcon} size={14} />
          </Button>
          <Button
            className="h-8 w-8 rounded-lg p-0 transition-all"
            onClick={() => onViewModeChange("map")}
            size="sm"
            variant={viewMode === "map" ? "secondary" : "ghost"}
          >
            <Icon icon={MapsLocation01Icon} size={14} />
          </Button>
        </div>

        <Button
          className={cn(
            "h-8 w-8 rounded-lg p-0 transition-all",
            isSidebarOpen
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
          onClick={onToggleSidebar}
          size="sm"
          variant="ghost"
        >
          <Icon icon={SidebarRight01Icon} size={16} />
        </Button>
      </div>
    </div>
  );
}
