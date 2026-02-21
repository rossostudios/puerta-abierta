"use client";

import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  isValidElement,
} from "react";

import { cn } from "@/lib/utils";

const TooltipProvider = BaseTooltip.Provider;
const Tooltip = BaseTooltip.Root;

type TooltipTriggerProps = ComponentPropsWithoutRef<
  typeof BaseTooltip.Trigger
> & {
  asChild?: boolean;
};

function TooltipTrigger({
  asChild = false,
  children,
  ...props
}: TooltipTriggerProps) {
  if (asChild) {
    if (!isValidElement(children)) {
      throw new Error("TooltipTrigger with asChild requires a React element.");
    }

    return <BaseTooltip.Trigger render={children} {...props} />;
  }

  return <BaseTooltip.Trigger {...props}>{children}</BaseTooltip.Trigger>;
}

type TooltipContentProps = ComponentPropsWithoutRef<
  typeof BaseTooltip.Popup
> & {
  align?: ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>["align"];
  side?: ComponentPropsWithoutRef<typeof BaseTooltip.Positioner>["side"];
  sideOffset?: ComponentPropsWithoutRef<
    typeof BaseTooltip.Positioner
  >["sideOffset"];
};

const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    { align = "center", className, side = "top", sideOffset = 10, ...props },
    ref
  ) => {
    return (
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner
          align={align}
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
        >
          <BaseTooltip.Popup
            className={(state) =>
              cn(
                "glass-float z-50 rounded-xl px-2.5 py-1.5 font-medium text-[11px] text-popover-foreground",
                "transition-[opacity,transform] duration-[120ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                state.open
                  ? "translate-y-0 opacity-100"
                  : "translate-y-0.5 opacity-0",
                className
              )
            }
            ref={ref}
            {...props}
          />
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    );
  }
);
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
