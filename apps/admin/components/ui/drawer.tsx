"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";

import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

type DrawerSide = "left" | "right";

type DrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: DrawerSide;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  closeLabel?: string;
};

export function Drawer({
  open,
  onOpenChange,
  side = "left",
  title,
  description,
  children,
  className,
  contentClassName,
  closeLabel = "Close",
}: DrawerProps) {
  return (
    <BaseDialog.Root onOpenChange={(next) => onOpenChange(next)} open={open}>
      <BaseDialog.Portal keepMounted>
        <BaseDialog.Backdrop
          className={(state) =>
            cn(
              "fixed inset-0 z-40 bg-[var(--overlay-scrim)] transition-opacity duration-[160ms] ease-[var(--shell-ease)] motion-reduce:transition-none",
              state.open
                ? "pointer-events-auto opacity-100"
                : "pointer-events-none opacity-0"
            )
          }
        />
        <BaseDialog.Popup
          className={(state) =>
            cn(
              "glass-sidebar fixed inset-y-0 z-50 flex h-full w-[min(86vw,320px)] flex-col",
              "transition-transform duration-[180ms] ease-[var(--shell-ease)] motion-reduce:transition-none",
              side === "left" ? "left-0" : "right-0",
              side === "left"
                ? state.open
                  ? "translate-x-0"
                  : "-translate-x-full"
                : state.open
                  ? "translate-x-0"
                  : "translate-x-full",
              state.open ? "pointer-events-auto" : "pointer-events-none",
              className
            )
          }
        >
          {title || description ? (
            <header className="flex items-start justify-between gap-3 border-sidebar-border/70 border-b px-4 py-3">
              <div className="min-w-0">
                {title ? (
                  <BaseDialog.Title className="truncate font-semibold text-[16px] text-foreground">
                    {title}
                  </BaseDialog.Title>
                ) : null}
                {description ? (
                  <BaseDialog.Description className="mt-0.5 text-[13px] text-foreground/62 leading-snug">
                    {description}
                  </BaseDialog.Description>
                ) : null}
              </div>
              <BaseDialog.Close
                aria-label={closeLabel}
                className={cn(
                  buttonVariants({ size: "icon", variant: "ghost" }),
                  "h-8 w-8 rounded-xl text-foreground/66 hover:text-foreground"
                )}
              >
                <Icon icon={Cancel01Icon} size={16} />
              </BaseDialog.Close>
            </header>
          ) : null}
          <div
            className={cn("min-h-0 flex-1 overflow-y-auto", contentClassName)}
          >
            {children}
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
