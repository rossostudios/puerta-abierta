import { Button as BaseButton } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  forwardRef,
  type Ref,
} from "react";

import { cn } from "@/lib/utils";

const UI_BASE_V2_ENABLED = process.env.NEXT_PUBLIC_UI_BASE_V2 !== "0";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl font-medium text-sm transition-[background-color,color,border-color,box-shadow] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline:
          "border border-border/40 bg-white/50 shadow-sm shadow-[inset_0_0.5px_0_rgba(255,255,255,0.8)] hover:bg-white/70 hover:text-accent-foreground dark:bg-white/[0.04] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.08]",
        secondary:
          "bg-white/50 text-secondary-foreground shadow-sm shadow-[inset_0_0.5px_0_rgba(255,255,255,0.8)] hover:bg-white/70 dark:bg-white/[0.06] dark:shadow-[inset_0_0.5px_0_rgba(255,255,255,0.06)] dark:hover:bg-white/[0.1]",
        ghost: "hover:bg-white/40 hover:text-accent-foreground dark:hover:bg-white/[0.06]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-11 rounded-xl px-8",
        icon: "h-9 w-9 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends ComponentPropsWithoutRef<typeof BaseButton>,
    VariantProps<typeof buttonVariants> {}

const Button = forwardRef<ElementRef<typeof BaseButton>, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    if (!UI_BASE_V2_ENABLED) {
      return (
        <button
          className={cn(buttonVariants({ variant, size, className }))}
          ref={ref as Ref<HTMLButtonElement>}
          {...props}
        />
      );
    }

    return (
      <BaseButton
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
