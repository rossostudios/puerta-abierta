"use client";

import {
  Alert02Icon,
  Building06Icon,
  CheckmarkCircle02Icon,
  City01Icon,
  Delete02Icon,
  DollarCircleIcon,
  Door01Icon,
  Layers01Icon,
  MoreVerticalIcon,
  PencilEdit02Icon,
  Tag01Icon,
  Task01Icon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import type { ColumnDef } from "@tanstack/react-table";

import type { PropertyPortfolioRow } from "@/lib/features/properties/types";
import { formatCurrency } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
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
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";

type PropertyTableColumnsProps = {
  isEn: boolean;
  formatLocale: "en-US" | "es-PY";
  onViewDetails: (id: string) => void;
};

function ColHeader({
  icon,
  label,
}: {
  icon: typeof Building06Icon;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground/70" icon={icon} size={14} />
      <span>{label}</span>
    </span>
  );
}

const HEALTH_DOT: Record<string, string> = {
  stable: "bg-[var(--status-success-fg)]",
  watch: "bg-[var(--status-warning-fg)]",
  critical: "bg-[var(--status-danger-fg)]",
};

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
    header: () => (
      <ColHeader
        icon={Building06Icon}
        label={isEn ? "Property" : "Propiedad"}
      />
    ),
    cell: ({ row }) => {
      const data = row.original;
      const dotClass = HEALTH_DOT[data.health] ?? "bg-muted-foreground";
      return (
        <div className="flex items-center gap-2.5">
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)}
            title={data.health}
          />
          <div className="flex flex-col">
            <span className="font-medium text-foreground text-sm">
              {data.name}
            </span>
            <span className="text-muted-foreground text-xs">
              {data.address}
            </span>
          </div>
        </div>
      );
    },
  },
  {
    accessorKey: "code",
    header: () => (
      <ColHeader icon={Tag01Icon} label={isEn ? "Code" : "Código"} />
    ),
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.code}
      </span>
    ),
  },
  {
    accessorKey: "city",
    header: () => (
      <ColHeader icon={City01Icon} label={isEn ? "City" : "Ciudad"} />
    ),
    cell: ({ row }) => (
      <span className="text-sm">{row.original.city}</span>
    ),
  },
  {
    accessorKey: "unitCount",
    header: () => (
      <ColHeader icon={Door01Icon} label={isEn ? "Units" : "Unidades"} />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">{row.original.unitCount}</span>
    ),
  },
  {
    accessorKey: "occupancyRate",
    header: () => (
      <ColHeader
        icon={Layers01Icon}
        label={isEn ? "Occupancy" : "Ocupación"}
      />
    ),
    cell: ({ row }) => {
      const rate = row.original.occupancyRate;
      let colorClass = "text-[var(--status-success-fg)]";
      if (rate < 50) colorClass = "text-[var(--status-danger-fg)]";
      else if (rate < 80) colorClass = "text-[var(--status-warning-fg)]";

      return (
        <span className={cn("tabular-nums text-sm font-medium", colorClass)}>
          {rate}%
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: () => (
      <ColHeader
        icon={CheckmarkCircle02Icon}
        label={isEn ? "Status" : "Estado"}
      />
    ),
    cell: ({ row }) => <StatusBadge value={row.original.status} />,
  },
  {
    accessorKey: "revenueMtdPyg",
    header: () => (
      <ColHeader
        icon={DollarCircleIcon}
        label={isEn ? "Revenue" : "Ingresos"}
      />
    ),
    cell: ({ row }) => (
      <span className="tabular-nums text-sm">
        {formatCurrency(row.original.revenueMtdPyg, "PYG", formatLocale)}
      </span>
    ),
  },
  {
    accessorKey: "openTaskCount",
    header: () => (
      <ColHeader icon={Task01Icon} label={isEn ? "Tasks" : "Tareas"} />
    ),
    cell: ({ row }) => {
      const count = row.original.openTaskCount;
      const urgent = row.original.urgentTaskCount;
      if (count === 0) {
        return <span className="text-muted-foreground text-sm">&mdash;</span>;
      }
      return (
        <span
          className={cn(
            "tabular-nums text-sm",
            urgent > 0 && "font-medium text-[var(--status-warning-fg)]"
          )}
        >
          {count}
        </span>
      );
    },
  },
  {
    accessorKey: "overdueCollectionCount",
    header: () => (
      <ColHeader icon={Alert02Icon} label={isEn ? "Overdue" : "Vencidos"} />
    ),
    cell: ({ row }) => {
      const count = row.original.overdueCollectionCount;
      if (count === 0) {
        return <span className="text-muted-foreground text-sm">&mdash;</span>;
      }
      return (
        <span className="tabular-nums text-sm font-medium text-[var(--status-danger-fg)]">
          {count}
        </span>
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
          <DropdownMenuTrigger
            className={cn(
              buttonVariants({ variant: "ghost" }),
              "h-8 w-8 p-0"
            )}
          >
            <span className="sr-only">Open menu</span>
            <Icon icon={MoreVerticalIcon} size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {isEn ? "Actions" : "Acciones"}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => onViewDetails(property.id)}>
              <Icon className="mr-2" icon={ViewIcon} size={14} />
              {isEn ? "View details" : "Ver detalles"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(property.id)}
            >
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
