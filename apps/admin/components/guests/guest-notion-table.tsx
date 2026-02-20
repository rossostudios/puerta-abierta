"use client";
"use no memo";

import {
  CalendarCheckIn01Icon,
  CalendarCheckOut01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  DollarCircleIcon,
  LanguageCircleIcon,
  Layers01Icon,
  MoreVerticalIcon,
  NoteEditIcon,
  PencilEdit02Icon,
  UserGroupIcon,
  ViewIcon,
} from "@hugeicons/core-free-icons";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useMemo, useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updateGuestInlineAction } from "@/app/(admin)/module/guests/actions";
import { LANGUAGE_OPTIONS } from "@/components/guests/guest-form";
import { EditableCell } from "@/components/properties/editable-cell";
import { Badge } from "@/components/ui/badge";
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
import { HoverLink } from "@/components/ui/hover-link";
import { Icon } from "@/components/ui/icon";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

import { asDateLabel, type GuestCrmRow, initials } from "./guests-crm-types";

/* ---------- helpers ---------- */

function ColHeader({
  icon,
  label,
}: {
  icon: typeof UserGroupIcon;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon className="text-muted-foreground/70" icon={icon} size={13} />
      <span>{label}</span>
    </span>
  );
}

/* ---------- types ---------- */

type OptimisticAction = {
  id: string;
  field: keyof GuestCrmRow;
  value: string;
};

type Props = {
  rows: GuestCrmRow[];
  isEn: boolean;
  locale: string;
  onRowClick: (row: GuestCrmRow) => void;
  onDelete: (row: GuestCrmRow) => void;
  onEdit: (row: GuestCrmRow) => void;
};

/* ---------- component ---------- */

export function GuestNotionTable({
  rows,
  isEn,
  locale,
  onRowClick,
  onDelete,
  onEdit,
}: Props) {
  "use no memo";
  const [, startTransition] = useTransition();

  const [optimisticRows, addOptimistic] = useOptimistic(
    rows,
    (current: GuestCrmRow[], action: OptimisticAction) =>
      current.map((r) =>
        r.id === action.id ? { ...r, [action.field]: action.value } : r
      )
  );

  const commitEdit = useCallback(
    async (guestId: string, field: string, next: string) => {
      startTransition(() => {
        addOptimistic({
          id: guestId,
          field: field as keyof GuestCrmRow,
          value: next,
        });
      });

      const result = await updateGuestInlineAction({
        guestId,
        field,
        value: next,
      });

      if (result.ok) {
        toast.success(isEn ? "Saved" : "Guardado");
      } else {
        toast.error(isEn ? "Failed to save" : "Error al guardar", {
          description: result.error,
        });
      }
    },
    [addOptimistic, isEn]
  );

  const languageSelectOptions = useMemo(
    () =>
      LANGUAGE_OPTIONS.filter((o) => o.value !== "").map((o) => ({
        label: isEn ? o.en : o.es,
        value: o.value,
      })),
    [isEn]
  );

  const t = useCallback((en: string, es: string) => (isEn ? en : es), [isEn]);

  const columns = useMemo<ColumnDef<GuestCrmRow>[]>(
    () => [
      {
        id: "select",
        size: 40,
        minSize: 40,
        maxSize: 40,
        enableResizing: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected()}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
          />
        ),
      },
      {
        id: "guest",
        accessorKey: "full_name",
        size: 260,
        minSize: 180,
        header: () => (
          <ColHeader icon={UserGroupIcon} label={t("Guest", "Huésped")} />
        ),
        cell: ({ row }) => {
          const guest = row.original;
          const href = `/module/guests/${guest.id}`;
          const emailVal = guest.email != null ? guest.email.trim() : "";
          const phoneVal =
            guest.phone_e164 != null ? guest.phone_e164.trim() : "";
          const contact =
            emailVal || phoneVal || t("No contact", "Sin contacto");

          return (
            <div className="min-w-0">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-muted/20 font-semibold text-primary">
                  {initials(guest.full_name)}
                </div>
                <div className="min-w-0">
                  <HoverLink
                    className="block max-w-[22rem] truncate font-medium text-foreground underline-offset-4 hover:underline"
                    description={t(
                      "Open guest CRM profile.",
                      "Abrir el perfil CRM del huésped."
                    )}
                    href={href}
                    id={guest.id}
                    label={guest.full_name}
                    meta={t("Guest", "Huésped")}
                    prefetch={false}
                  >
                    {guest.full_name}
                  </HoverLink>
                  <p className="max-w-[22rem] truncate text-muted-foreground text-xs">
                    {contact}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {guest.next_stay_start ? (
                      <Badge className="gap-1" variant="secondary">
                        <Icon icon={CalendarCheckIn01Icon} size={14} />
                        {t("Upcoming", "Próxima")}
                      </Badge>
                    ) : null}
                    {guest.reservation_count > 1 ? (
                      <Badge variant="outline">
                        {t("Returning", "Recurrente")}
                      </Badge>
                    ) : null}
                    {(() => {
                      const gn = guest.notes != null ? guest.notes : "";
                      if (!gn.trim()) return null;
                      return (
                        <Badge className="gap-1" variant="outline">
                          <Icon icon={NoteEditIcon} size={14} />
                          {t("Notes", "Notas")}
                        </Badge>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
          );
        },
      },
      {
        id: "stays",
        accessorKey: "reservation_count",
        size: 80,
        minSize: 60,
        header: () => (
          <ColHeader icon={Layers01Icon} label={t("Stays", "Estancias")} />
        ),
        cell: ({ row }) => (
          <span className="inline-flex items-center rounded-full border bg-background/60 px-2 py-1 font-mono text-[11px]">
            {row.original.reservation_count}
          </span>
        ),
      },
      {
        id: "next",
        accessorKey: "next_stay_start",
        size: 120,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={CalendarCheckIn01Icon}
            label={t("Next stay", "Próxima estancia")}
          />
        ),
        cell: ({ row }) => {
          const guest = row.original;
          const label = asDateLabel(locale, guest.next_stay_start);
          return label ? (
            <span title={guest.next_stay_start ?? undefined}>{label}</span>
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          );
        },
      },
      {
        id: "last",
        accessorKey: "last_stay_end",
        size: 120,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={CalendarCheckOut01Icon}
            label={t("Last stay", "Última estancia")}
          />
        ),
        cell: ({ row }) => {
          const guest = row.original;
          const label = asDateLabel(locale, guest.last_stay_end);
          return label ? (
            <span title={guest.last_stay_end ?? undefined}>{label}</span>
          ) : (
            <span className="text-muted-foreground">&mdash;</span>
          );
        },
      },
      {
        id: "value",
        accessorKey: "lifetime_value",
        size: 120,
        minSize: 90,
        header: () => <ColHeader icon={DollarCircleIcon} label="LTV" />,
        cell: ({ row }) => (
          <span className="text-sm tabular-nums">
            {formatCurrency(row.original.lifetime_value, "PYG", locale)}
          </span>
        ),
      },
      {
        id: "language",
        accessorKey: "preferred_language",
        size: 100,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={LanguageCircleIcon}
            label={t("Language", "Idioma")}
          />
        ),
        cell: ({ row }) => {
          const guest = row.original;
          const val = guest.preferred_language ?? "";
          const opt = LANGUAGE_OPTIONS.find((o) => o.value === val);
          const displayLabel = opt ? (isEn ? opt.en : opt.es) : val;
          return (
            <EditableCell
              displayNode={
                <span className="text-sm">{displayLabel || "\u00A0"}</span>
              }
              onCommit={(next) =>
                commitEdit(guest.id, "preferred_language", next)
              }
              options={languageSelectOptions}
              type="select"
              value={val}
            />
          );
        },
      },
      {
        id: "verification",
        accessorKey: "verification_status",
        size: 100,
        minSize: 80,
        header: () => (
          <ColHeader
            icon={CheckmarkCircle02Icon}
            label={t("Verified", "Verificado")}
          />
        ),
        cell: ({ row }) => {
          const status = row.original.verification_status;
          if (!status)
            return <span className="text-muted-foreground">{"\u2014"}</span>;
          return (
            <StatusBadge
              tone={
                status === "verified"
                  ? "success"
                  : status === "pending"
                    ? "warning"
                    : status === "rejected"
                      ? "danger"
                      : "neutral"
              }
              value={status}
            />
          );
        },
      },
      {
        id: "actions",
        size: 48,
        minSize: 48,
        maxSize: 48,
        enableResizing: false,
        cell: ({ row }) => {
          const guest = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "h-7 w-7 p-0"
                )}
              >
                <span className="sr-only">Open menu</span>
                <Icon icon={MoreVerticalIcon} size={15} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  {t("Actions", "Acciones")}
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onRowClick(guest)}>
                  <Icon className="mr-2" icon={ViewIcon} size={14} />
                  {t("View", "Ver")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEdit(guest)}>
                  <Icon className="mr-2" icon={PencilEdit02Icon} size={14} />
                  {t("Edit", "Editar")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => navigator.clipboard.writeText(guest.id)}
                >
                  {t("Copy ID", "Copiar ID")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:bg-red-50 focus:text-red-600 dark:focus:bg-red-900/10"
                  onClick={() => onDelete(guest)}
                >
                  <Icon className="mr-2" icon={Delete02Icon} size={14} />
                  {t("Delete", "Eliminar")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [
      isEn,
      locale,
      t,
      commitEdit,
      languageSelectOptions,
      onRowClick,
      onEdit,
      onDelete,
    ]
  );

  const totalStays = useMemo(
    () => optimisticRows.reduce((sum, r) => sum + r.reservation_count, 0),
    [optimisticRows]
  );
  const totalLtv = useMemo(
    () => optimisticRows.reduce((sum, r) => sum + r.lifetime_value, 0),
    [optimisticRows]
  );

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable({
    data: optimisticRows,
    columns,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table
        className="w-full table-fixed"
        style={{ minWidth: table.getTotalSize() }}
      >
        <TableHeader>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => (
                <TableHead
                  className="relative select-none whitespace-nowrap text-[11px] uppercase tracking-wider"
                  grid
                  key={header.id}
                  style={{ width: header.getSize() }}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}

                  {header.column.getCanResize() && (
                    <button
                      aria-label="Resize column"
                      className={cn(
                        "absolute top-0 right-0 h-full w-1 cursor-col-resize touch-none select-none",
                        "hover:bg-primary/30",
                        header.column.getIsResizing() && "bg-primary/50"
                      )}
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      type="button"
                    />
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>

        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow
              className="cursor-pointer hover:bg-muted/20"
              data-state={row.getIsSelected() && "selected"}
              key={row.id}
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (
                  target.closest("button") ||
                  target.closest("a") ||
                  target.closest("input") ||
                  target.closest("select") ||
                  target.closest("[role='menuitem']")
                )
                  return;
                onRowClick(row.original);
              }}
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell
                  className="py-1.5"
                  grid
                  key={cell.id}
                  style={{ width: cell.column.getSize() }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>

        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell grid style={{ width: 40 }} />
            <TableCell
              className="font-medium text-xs uppercase tracking-wider"
              grid
            >
              {optimisticRows.length} {t("Guests", "Huéspedes")}
            </TableCell>
            <TableCell className="tabular-nums" grid>
              {totalStays}
            </TableCell>
            <TableCell grid />
            <TableCell grid />
            <TableCell className="tabular-nums" grid>
              {formatCurrency(totalLtv, "PYG", locale)}
            </TableCell>
            <TableCell grid />
            <TableCell grid />
            <TableCell grid />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
