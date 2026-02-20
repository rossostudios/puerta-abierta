import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import { isInputFocused } from "@/lib/hotkeys/is-input-focused";

type TableHotkeyOptions<T> = {
  rows: T[];
  onOpen: (row: T) => void;
  onToggleSelect?: (row: T) => void;
  enabled: boolean;
};

export function useTableHotkeys<T>({
  rows,
  onOpen,
  onToggleSelect,
  enabled,
}: TableHotkeyOptions<T>): {
  focusedRowIndex: number;
  setFocusedRowIndex: (index: number) => void;
} {
  const [focusedRowIndex, setFocusedRowIndex] = useState(-1);

  // Reset focus when rows change or disabled
  useEffect(() => {
    if (!enabled) setFocusedRowIndex(-1);
  }, [enabled]);

  useHotkey("J", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    e.preventDefault();
    setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
  });

  useHotkey("ArrowDown", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    e.preventDefault();
    setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
  });

  useHotkey("K", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    e.preventDefault();
    setFocusedRowIndex((prev) => Math.max(prev - 1, prev === -1 ? -1 : 0));
  });

  useHotkey("ArrowUp", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    e.preventDefault();
    setFocusedRowIndex((prev) => Math.max(prev - 1, prev === -1 ? -1 : 0));
  });

  useHotkey("Enter", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    if (focusedRowIndex >= 0 && focusedRowIndex < rows.length) {
      e.preventDefault();
      onOpen(rows[focusedRowIndex]);
    }
  });

  useHotkey("X", (e: KeyboardEvent) => {
    if (!enabled || rows.length === 0 || isInputFocused()) return;
    if (
      focusedRowIndex >= 0 &&
      focusedRowIndex < rows.length &&
      onToggleSelect
    ) {
      e.preventDefault();
      onToggleSelect(rows[focusedRowIndex]);
    }
  });

  useHotkey("Escape", (_e: KeyboardEvent) => {
    if (!enabled || isInputFocused()) return;
    setFocusedRowIndex(-1);
  });

  return { focusedRowIndex, setFocusedRowIndex };
}
