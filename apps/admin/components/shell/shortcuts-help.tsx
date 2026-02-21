"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useRef } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { getShortcutsByCategory } from "@/lib/hotkeys/config";
import { useIsMac } from "@/lib/hotkeys/use-is-mac";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ShortcutsHelpProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
};

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-muted/60 px-1.5 font-medium font-mono text-foreground text-xs shadow-[0_1px_0_1px_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}

function KeyDisplay({ keys, isMac }: { keys: string[]; isMac: boolean }) {
  return keys.map((key, i) => {
    const display = key === "Mod" ? (isMac ? "⌘" : "Ctrl") : key;
    return (
      <span className="inline-flex items-center gap-0.5" key={key}>
        {i > 0 && (
          <span className="mx-0.5 text-muted-foreground text-xs">
            {keys[0] === "G" ? "then" : "+"}
          </span>
        )}
        <Kbd>{display}</Kbd>
      </span>
    );
  });
}

export function ShortcutsHelp({
  open,
  onOpenChange,
  locale,
}: ShortcutsHelpProps) {
  const isMac = useIsMac();
  const isEn = locale === "en-US";
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [open, onOpenChange]);

  if (!open) return null;

  const groups = getShortcutsByCategory(locale);

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[var(--overlay-scrim-strong)] backdrop-blur-[3px]"
        onClick={() => onOpenChange(false)}
      />
      <div className="absolute inset-4 flex items-start justify-center overflow-auto pt-[6vh] pb-8 sm:inset-8">
        <div
          className="glass-float w-full max-w-2xl rounded-2xl"
          ref={panelRef}
        >
          <div className="flex items-center justify-between border-border/75 border-b px-5 py-4">
            <h2 className="font-semibold text-lg tracking-tight">
              {isEn ? "Keyboard shortcuts" : "Atajos de teclado"}
            </h2>
            <button
              aria-label={isEn ? "Close" : "Cerrar"}
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-8 w-8 rounded-xl"
              )}
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <Icon icon={Cancel01Icon} size={16} />
            </button>
          </div>

          <div className="grid gap-6 p-5 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.category}>
                <h3 className="mb-2.5 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  {group.label}
                </h3>
                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5"
                      key={shortcut.id}
                    >
                      <span className="text-foreground/90 text-sm">
                        {shortcut.localizedLabel}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <KeyDisplay isMac={isMac} keys={shortcut.keys} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="border-border/75 border-t px-5 py-3 text-center text-muted-foreground text-xs">
            {isEn
              ? "Press ? anywhere to toggle this panel"
              : "Presiona ? en cualquier lugar para mostrar este panel"}
          </div>
        </div>
      </div>
    </div>
  );
}
