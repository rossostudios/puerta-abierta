import { useCallback, useEffect, useState } from "react";
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

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!enabled || rows.length === 0) return;
      if (isInputFocused()) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key;

      if (key === "j" || key === "ArrowDown") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.min(prev + 1, rows.length - 1));
        return;
      }

      if (key === "k" || key === "ArrowUp") {
        event.preventDefault();
        setFocusedRowIndex((prev) => Math.max(prev - 1, prev === -1 ? -1 : 0));
        return;
      }

      if (key === "Enter" && focusedRowIndex >= 0 && focusedRowIndex < rows.length) {
        event.preventDefault();
        onOpen(rows[focusedRowIndex]);
        return;
      }

      if (key === "x" && focusedRowIndex >= 0 && focusedRowIndex < rows.length && onToggleSelect) {
        event.preventDefault();
        onToggleSelect(rows[focusedRowIndex]);
        return;
      }

      if (key === "Escape") {
        setFocusedRowIndex(-1);
      }
    },
    [enabled, focusedRowIndex, onOpen, onToggleSelect, rows]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return { focusedRowIndex, setFocusedRowIndex };
}
