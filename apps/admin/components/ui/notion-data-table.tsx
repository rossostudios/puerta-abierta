"use client";
"use no memo";

import { useHotkey } from "@tanstack/react-hotkeys";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";
import { cn } from "@/lib/utils";

type NotionDataTableProps<TRow> = {
  data: TRow[];
  columns: ColumnDef<TRow, unknown>[];
  renderRowActions?: (row: TRow) => ReactNode;
  rowActionsHeader?: string;
  hideSearch?: boolean;
  searchPlaceholder?: string;
  footer?: ReactNode;
  defaultPageSize?: number;
  isEn?: boolean;
  onRowClick?: (row: TRow) => void;
  enableSelection?: boolean;
  onSelectionChange?: (selectedRows: TRow[]) => void;
  getRowId?: (row: TRow) => string;
};

function RowActionsCell<TRow>({
  row,
  render,
}: {
  row: TRow;
  render: (row: TRow) => ReactNode;
}) {
  return <div className="flex justify-end">{render(row)}</div>;
}

export function NotionDataTable<TRow>({
  data,
  columns: columnsProp,
  renderRowActions,
  rowActionsHeader,
  hideSearch = false,
  searchPlaceholder,
  footer,
  defaultPageSize = 50,
  isEn = true,
  onRowClick,
  enableSelection = false,
  onSelectionChange,
  getRowId,
}: NotionDataTableProps<TRow>) {
  "use no memo";
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  const handleRowSelectionChange = useCallback(
    (
      updater:
        | RowSelectionState
        | ((prev: RowSelectionState) => RowSelectionState)
    ) => {
      setRowSelection((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        if (onSelectionChange) {
          const selectedIndices = Object.keys(next).filter((k) => next[k]);
          const selectedRows = selectedIndices
            .map((idx) => data[Number(idx)])
            .filter((row): row is TRow => row != null);
          onSelectionChange(selectedRows);
        }
        return next;
      });
    },
    [data, onSelectionChange]
  );

  const columns = useMemo(() => {
    const cols: ColumnDef<TRow, unknown>[] = [];

    if (enableSelection) {
      cols.push({
        id: "__select",
        size: 40,
        minSize: 40,
        enableSorting: false,
        enableResizing: false,
        header: ({ table: t }) => (
          <div data-row-click="ignore">
            <Checkbox
              checked={t.getIsAllPageRowsSelected()}
              onCheckedChange={(checked) =>
                t.toggleAllPageRowsSelected(!!checked)
              }
            />
          </div>
        ),
        cell: ({ row }) => (
          <div data-row-click="ignore">
            <Checkbox
              checked={row.getIsSelected()}
              onCheckedChange={(checked) => row.toggleSelected(!!checked)}
            />
          </div>
        ),
      } satisfies ColumnDef<TRow, unknown>);
    }

    cols.push(...columnsProp);

    if (renderRowActions) {
      cols.push({
        id: "__actions",
        header: rowActionsHeader ?? "",
        size: 120,
        minSize: 80,
        enableSorting: false,
        enableResizing: false,
        cell: ({ row }) => (
          <RowActionsCell render={renderRowActions} row={row.original} />
        ),
      });
    }

    return cols;
  }, [columnsProp, enableSelection, renderRowActions, rowActionsHeader]);

  // eslint-disable-next-line react-hooks-js/incompatible-library
  const table = useReactTable<TRow>({
    data,
    columns,
    columnResizeMode: "onChange",
    state: enableSelection
      ? { sorting, globalFilter, pagination, rowSelection }
      : { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    onRowSelectionChange: enableSelection
      ? handleRowSelectionChange
      : undefined,
    enableRowSelection: enableSelection,
    getRowId: getRowId ? (row: TRow) => getRowId(row) : undefined,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const filteredCount = table.getFilteredRowModel().rows.length;
  const totalCount = data.length;

  const inputRef = useRef<HTMLInputElement>(null);

  useHotkey("/", (e) => {
    if (isInputFocused() || hideSearch) return;
    e.preventDefault();
    inputRef.current?.focus();
  });

  return (
    <div className="min-w-0 space-y-3">
      {!hideSearch && (
        <div className="flex items-center gap-2">
          <Input
            className="max-w-xs"
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={
              searchPlaceholder ?? (isEn ? "Filter..." : "Filtrar...")
            }
            ref={inputRef}
            value={globalFilter}
          />
          {globalFilter && (
            <Button
              onClick={() => setGlobalFilter("")}
              size="sm"
              variant="outline"
            >
              {isEn ? "Reset" : "Reiniciar"}
            </Button>
          )}
        </div>
      )}

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
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button
                        className="inline-flex items-center gap-1 hover:underline"
                        onClick={header.column.getToggleSortingHandler()}
                        type="button"
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getIsSorted() === "asc"
                          ? " ↑"
                          : header.column.getIsSorted() === "desc"
                            ? " ↓"
                            : ""}
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )
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
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  className={cn(
                    "hover:bg-muted/20",
                    onRowClick && "cursor-pointer"
                  )}
                  key={row.id}
                  onClick={(event) => {
                    if (!onRowClick) return;
                    const target = event.target as HTMLElement | null;
                    if (
                      target?.closest(
                        'a,button,input,select,textarea,label,[role="button"],[data-row-click="ignore"]'
                      )
                    ) {
                      return;
                    }
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
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  className="py-8 text-center text-muted-foreground"
                  colSpan={columns.length}
                >
                  {isEn ? "No records" : "Sin registros"}
                </TableCell>
              </TableRow>
            )}
          </TableBody>

          {footer ? <TableFooter>{footer}</TableFooter> : null}
        </Table>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="text-muted-foreground text-sm">
          {filteredCount !== totalCount
            ? `${filteredCount} / ${totalCount}`
            : `${totalCount}`}{" "}
          {isEn ? "rows" : "filas"}
        </div>

        <div className="flex items-center gap-2">
          <Button
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
            size="sm"
            variant="outline"
          >
            {isEn ? "Previous" : "Anterior"}
          </Button>
          <span className="text-muted-foreground text-sm">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <Button
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
            size="sm"
            variant="outline"
          >
            {isEn ? "Next" : "Siguiente"}
          </Button>
        </div>
      </div>
    </div>
  );
}
