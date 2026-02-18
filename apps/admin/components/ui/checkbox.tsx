"use client";

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Tick01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export function Checkbox({
    className,
    ...props
}: ComponentProps<typeof CheckboxPrimitive.Root>) {
    return (
        <CheckboxPrimitive.Root
            className={cn(
                "peer inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-input ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[checked]:border-primary data-[checked]:bg-primary data-[checked]:text-primary-foreground",
                className
            )}
            {...props}
        >
            <CheckboxPrimitive.Indicator
                className={cn("flex items-center justify-center text-current")}
            >
                <Icon icon={Tick01Icon} size={12} strokeWidth={3} />
            </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
    );
}
