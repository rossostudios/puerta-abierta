"use client";

import {
  Alert02Icon,
  Delete02Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";

import type { PropertyPortfolioRow } from "@/lib/features/properties/types";
import { formatCurrency } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
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
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type PropertyTableColumnsProps = {
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  onViewDetails: (id: string) => void;
};

function getCoverClassName(row: PropertyPortfolioRow): string {
  if (row.status === "inactive") {
    return "from-[var(--muted)] to-[var(--border)]";
  }

  if (row.health === "critical") {
    return "from-[var(--status-danger-bg)] to-[var(--status-danger-border)]";
  }

  if (row.health === "watch") {
    return "from-[var(--status-warning-bg)] to-[var(--status-warning-border)]";
  }

  return "from-[var(--status-success-bg)] to-[var(--status-success-border)]";
}

export const getPropertyColumns = ({
  isEn,
  formatLocale,
  onViewDetails,
}: PropertyTableColumnsProps): ColumnDef<PropertyPortfolioRow>[] => [
  {
    id: "select",
    header: ({ table }) => (
      <Checkbox
        aria-label="Select all"
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={table.getIsSomePageRowsSelected()}
        onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label="Select row"
        checked={row.getIsSelected()}
        onCheckedChange={(value) => row.toggleSelected(!!value)}
      />
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "name",
    header: isEn ? "Property" : "Propiedad",
    cell: ({ row }) => {
      const data = row.original;
      return (
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-gradient-to-br shadow-inner",
              getCoverClassName(data)
            )}
          />
          <div className="flex flex-col">
            <span className="font-medium text-foreground text-sm">{data.name}</span>
            <span className="text-muted-foreground text-xs">{data.address}</span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "occupancyRate",
    header: isEn ? "Occupancy" : "Ocupación",
    cell: ({ row }) => {
      const rate = row.original.occupancyRate;
      let color = "bg-[var(--status-success-fg)]";
      if (rate < 50) color = "bg-[var(--status-danger-fg)]";
      else if (rate < 80) color = "bg-[var(--status-warning-fg)]";

      return (
        <div className="w-[140px] space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {isEn ? "Occupied" : "Ocupado"}
            </span>
            <span
              className={cn(
                "font-medium",
                rate < 80
                  ? "text-[var(--status-warning-fg)]"
                  : "text-[var(--status-success-fg)]"
              )}
            >
              {rate}%
            </span>
          </div>
          <Progress className="h-1.5" indicatorClassName={color} value={rate} />
        </div>
      );
    },
  },
  {
    accessorKey: "revenueMtdPyg",
    header: isEn ? "Revenue (MTD)" : "Ingresos (Mes)",
    cell: ({ row }) => {
      const revenue = row.original.revenueMtdPyg;
      const value = formatCurrency(revenue, "PYG", formatLocale).split(/\s/)[0] ?? "0";

      return (
        <div className="flex flex-col">
          <span className="font-medium text-sm">{value}</span>
        </div>
      );
    },
  },
  {
    accessorKey: "openTaskCount",
    header: isEn ? "Maintenance Tasks" : "Tareas Mantenimiento",
    cell: ({ row }) => {
      const count = row.original.openTaskCount;
      const urgent = row.original.urgentTaskCount;

      if (count === 0) {
        return (
          <Badge className="border-dashed font-normal text-muted-foreground" variant="outline">
            {isEn ? "No tasks" : "Sin tareas"}
          </Badge>
        );
      }

      return (
        <div className="flex items-center gap-2">
          <Badge className="gap-1.5 bg-secondary/50" variant="secondary">
            <Icon
              className={
                urgent > 0 ? "text-[var(--status-warning-fg)]" : "text-muted-foreground"
              }
              icon={Task01Icon}
              size={12}
            />
            {count} {isEn ? "Active" : "Activas"}
          </Badge>
          {urgent > 0 ? (
            <Icon className="animate-pulse text-red-500" icon={Alert02Icon} size={16} />
          ) : null}
        </div>
      );
    },
  },
  {
    accessorKey: "overdueCollectionCount",
    header: isEn ? "Overdue" : "Vencidos",
    cell: ({ row }) => {
      const count = row.original.overdueCollectionCount;
      if (count === 0) {
        return <span className="text-muted-foreground text-sm">&mdash;</span>;
      }
      return (
        <Badge className="gap-1.5 status-tone-danger border" variant="secondary">
          <Icon icon={Alert02Icon} size={12} />
          {count}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    enableHiding: false,
    cell: ({ row }) => {
      const property = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger className={cn(buttonVariants({ variant: "ghost" }), "h-8 w-8 p-0")}>
            <span className="sr-only">Open menu</span>
            <Icon icon={MoreVerticalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{isEn ? "Actions" : "Acciones"}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onViewDetails(property.id)}>
              <Icon className="mr-2" icon={ViewIcon} size={14} />
              {isEn ? "View details" : "Ver detalles"}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(property.id)}>
              <Icon className="mr-2" icon={PencilEdit02Icon} size={14} />
              {isEn ? "Copy ID" : "Copiar ID"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-900/10">
              <Icon className="mr-2" icon={Delete02Icon} size={14} />
              {isEn ? "Delete" : "Eliminar"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];
