import { forwardRef, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => (
    <textarea
      className={cn(
        "flex min-h-[112px] w-full resize-none rounded-xl border border-input/90 bg-background/88 px-3.5 py-2.5 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground/85 focus-visible:border-ring/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
Textarea.displayName = "Textarea";

export { Textarea };
