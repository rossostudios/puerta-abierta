"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type SheetSide = "right" | "left";

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  side?: SheetSide;
  contentClassName?: string;
};

const ANIMATION_MS = 180;

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  side = "right",
  contentClassName,
}: SheetProps) {
  const titleId = useId();
  const descriptionId = useId();
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      previouslyFocusedRef.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setMounted(true);
      window.setTimeout(() => closeRef.current?.focus(), 0);
      return;
    }

    const handle = window.setTimeout(() => setMounted(false), ANIMATION_MS);
    return () => window.clearTimeout(handle);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mounted, onOpenChange]);

  useEffect(() => {
    if (!mounted) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus?.();
      previouslyFocusedRef.current = null;
    };
  }, [mounted]);

  if (!mounted) return null;

  const panelSide =
    side === "right"
      ? {
          wrapper: "right-3",
          enter: "translate-x-full",
          exit: "translate-x-0",
        }
      : {
          wrapper: "left-3",
          enter: "-translate-x-full",
          exit: "translate-x-0",
        };

  return (
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden="true"
        className={cn(
          "absolute inset-0 bg-black/24 backdrop-blur-[3px] transition-opacity dark:bg-black/60",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={() => onOpenChange(false)}
      />

      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-modal="true"
        className={cn(
          "absolute top-3 bottom-3 flex w-[min(96vw,44rem)] max-w-[calc(100vw-24px)] flex-col rounded-[28px] border border-border/80 bg-background/95 shadow-[0_24px_56px_rgba(15,23,42,0.2)] transition-transform",
          panelSide.wrapper,
          open
            ? cn(panelSide.exit, "pointer-events-auto")
            : cn(panelSide.enter, "pointer-events-none"),
          contentClassName
        )}
        role="dialog"
        style={{ transitionDuration: `${ANIMATION_MS}ms` }}
      >
        <header className="flex items-start justify-between gap-4 border-border/70 border-b px-6 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="truncate font-semibold text-base" id={titleId}>
                {title}
              </h2>
            ) : null}
            {description ? (
              <p
                className="mt-1 text-muted-foreground/90 text-sm"
                id={descriptionId}
              >
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Cerrar"
            className={cn(
              buttonVariants({ variant: "ghost", size: "icon" }),
              "h-9 w-9 shrink-0 rounded-xl"
            )}
            onClick={() => onOpenChange(false)}
            ref={closeRef}
            type="button"
          >
            <Icon icon={Cancel01Icon} size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{children}</div>

        {footer ? (
          <footer className="border-border/70 border-t px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
