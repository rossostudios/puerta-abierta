import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      className={cn(
        "flex h-10 w-full rounded-xl border border-input/90 bg-background/88 px-3.5 py-2 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-[border-color,box-shadow,background-color] focus-visible:border-ring/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Select.displayName = "Select";

export { Select };
