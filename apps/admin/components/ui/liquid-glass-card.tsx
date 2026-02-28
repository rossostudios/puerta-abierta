import { forwardRef, type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const LiquidGlassCard = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn(
      "glass-liquid rounded-[24px] text-card-foreground",
      className
    )}
    ref={ref}
    {...props}
  />
));
LiquidGlassCard.displayName = "LiquidGlassCard";

const LiquidGlassCardContent = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div className={cn("p-6 pt-0", className)} ref={ref} {...props} />
));
LiquidGlassCardContent.displayName = "LiquidGlassCardContent";

const LiquidGlassCardFooter = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn("flex items-center p-6 pt-0", className)}
    ref={ref}
    {...props}
  />
));
LiquidGlassCardFooter.displayName = "LiquidGlassCardFooter";

const LiquidGlassCardHeader = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    ref={ref}
    {...props}
  />
));
LiquidGlassCardHeader.displayName = "LiquidGlassCardHeader";

const LiquidGlassCardTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(({ className, children, ...props }, ref) => (
  <h3
    className={cn("font-semibold leading-tight", className)}
    ref={ref}
    {...props}
  >
    {children}
  </h3>
));
LiquidGlassCardTitle.displayName = "LiquidGlassCardTitle";

export {
  LiquidGlassCard,
  LiquidGlassCardContent,
  LiquidGlassCardFooter,
  LiquidGlassCardHeader,
  LiquidGlassCardTitle,
};
