"use client";

import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

const PopoverRoot = BasePopover.Root;
const PopoverTrigger = BasePopover.Trigger;

type PopoverContentProps = Omit<
  ComponentPropsWithoutRef<typeof BasePopover.Popup>,
  "className"
> & {
  className?: string;
  sideOffset?: number;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
};

function PopoverContent({
  className,
  sideOffset = 8,
  align = "center",
  side = "bottom",
  children,
  ...props
}: PopoverContentProps) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner align={align} side={side} sideOffset={sideOffset}>
        <BasePopover.Popup
          className={cn(
            "z-50 min-w-[220px] rounded-xl border border-border/80 bg-popover p-1 text-popover-foreground shadow-lg outline-none",
            "fade-in-0 zoom-in-95 animate-in",
            className
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  );
}

export { PopoverRoot, PopoverTrigger, PopoverContent };
