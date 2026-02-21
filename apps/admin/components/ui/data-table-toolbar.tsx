"use client";

import { useHotkey } from "@tanstack/react-hotkeys";
import type { Table as ReactTable } from "@tanstack/react-table";
import { useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { humanizeKey } from "@/lib/format";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";
import { cn } from "@/lib/utils";
import type { DataTableRow } from "./data-table-types";

export function DataTableToolbar<TRow extends DataTableRow>({
  table,
  globalFilter,
  setGlobalFilter,
  active,
  reset,
  hideSearch,
  searchPlaceholder,
  isEn,
}: {
  table: ReactTable<TRow>;
  globalFilter: string;
  setGlobalFilter: (value: string) => void;
  active: boolean;
  reset: () => void;
  hideSearch: boolean;
  searchPlaceholder: string;
  isEn: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useHotkey("/", (e) => {
    if (isInputFocused() || hideSearch) return;
    e.preventDefault();
    inputRef.current?.focus();
  });

  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {!hideSearch && (
          <>
            <Input
              onChange={(event) => setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
              ref={inputRef}
              value={globalFilter}
            />
            {active ? (
              <Button onClick={reset} size="sm" variant="outline">
                {isEn ? "Reset" : "Reiniciar"}
              </Button>
            ) : null}
          </>
        )}
      </div>

      <details className="relative">
        <summary
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "cursor-pointer list-none"
          )}
        >
          {isEn ? "Columns" : "Columnas"}
        </summary>
        <div className="glass-float absolute right-0 z-20 mt-2 w-64 rounded-xl p-2">
          <p className="px-2 pb-1 font-medium text-muted-foreground text-xs">
            {isEn ? "Show/hide columns" : "Mostrar/ocultar columnas"}
          </p>
          <div className="max-h-64 overflow-auto">
            {table
              .getAllLeafColumns()
              .filter((column) => column.getCanHide())
              .map((column) => (
                <label
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted/50"
                  key={column.id}
                >
                  <input
                    checked={column.getIsVisible()}
                    onChange={column.getToggleVisibilityHandler()}
                    type="checkbox"
                  />
                  <span className="truncate">{humanizeKey(column.id)}</span>
                </label>
              ))}
          </div>
        </div>
      </details>
    </div>
  );
}
