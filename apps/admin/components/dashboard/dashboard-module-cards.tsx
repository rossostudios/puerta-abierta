"use client";

import { ArrowRight01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { getModuleDescription, getModuleLabel, MODULES } from "@/lib/modules";
import { cn } from "@/lib/utils";

type DashboardModuleCardsProps = {
  locale: Locale;
  isEn: boolean;
};

export function DashboardModuleCards({
  locale,
  isEn,
}: DashboardModuleCardsProps) {
  return (
    <section className="grid gap-4 md:grid-cols-2 lg:hidden xl:grid-cols-3">
      {MODULES.map((module) => {
        const label = getModuleLabel(module, locale);
        const description = getModuleDescription(module, locale);

        return (
          <Card key={module.slug}>
            <CardHeader className="space-y-2">
              <Badge className="w-fit" variant="secondary">
                {isEn ? "Module" : "Modulo"}
              </Badge>
              <CardTitle className="text-lg">{label}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href={`/module/${module.slug}`}
              >
                {isEn ? "Open module" : "Abrir modulo"}
                <Icon icon={ArrowRight01Icon} size={14} />
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
