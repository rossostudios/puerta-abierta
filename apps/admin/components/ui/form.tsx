"use client";

import { Form as BaseForm } from "@base-ui/react/form";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type FormProps = ComponentPropsWithoutRef<typeof BaseForm>;

export function Form({ className, ...props }: FormProps) {
  return <BaseForm className={cn(className)} {...props} />;
}
