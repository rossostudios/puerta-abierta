"use client";

import { useCallback } from "react";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type QuickReplyChipsProps = {
  suggestions: string[];
  onSelect?: (suggestion: string) => void;
  disabled?: boolean;
};

export function QuickReplyChips({
  suggestions,
  onSelect,
  disabled,
}: QuickReplyChipsProps) {
  const handleSelect = useCallback(
    (suggestion: string) => {
      onSelect?.(suggestion);
    },
    [onSelect]
  );

  if (suggestions.length === 0) return null;

  return (
    <div className="mt-2.5">
      <ScrollArea className="w-full overflow-x-auto whitespace-nowrap">
        <div className="flex w-max flex-nowrap items-center gap-1.5">
          {suggestions.map((suggestion) => (
            <button
              className={cn(
                "shrink-0 rounded-full border border-border/50 bg-muted/30 px-3 py-1.5",
                "font-medium text-[11.5px] text-foreground/70",
                "transition-all duration-150",
                "hover:border-[var(--sidebar-primary)]/40 hover:bg-[var(--sidebar-primary)]/[0.06] hover:text-foreground",
                "active:scale-[0.97]",
                disabled && "pointer-events-none opacity-40"
              )}
              disabled={disabled}
              key={suggestion}
              onClick={() => handleSelect(suggestion)}
              type="button"
            >
              {suggestion}
            </button>
          ))}
        </div>
        <ScrollBar className="hidden" orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
