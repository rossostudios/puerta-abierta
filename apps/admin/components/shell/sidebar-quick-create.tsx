"use client";

import {
  Add01Icon,
  Door01Icon,
  File01Icon,
  Home01Icon,
  Invoice01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useState } from "react";

import { Icon } from "@/components/ui/icon";
import {
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Locale } from "@/lib/i18n";

const QUICK_CREATE_ITEMS = [
  {
    href: "/module/properties?new=1",
    icon: Home01Icon,
    label: { "en-US": "Property", "es-PY": "Propiedad" },
  },
  {
    href: "/module/leases?new=1",
    icon: File01Icon,
    label: { "en-US": "Lease", "es-PY": "Contrato" },
  },
  {
    href: "/module/collections?new=1",
    icon: Invoice01Icon,
    label: { "en-US": "Invoice", "es-PY": "Cobro" },
  },
  {
    href: "/module/units?new=1",
    icon: Door01Icon,
    label: { "en-US": "Unit", "es-PY": "Unidad" },
  },
] as const;

export function SidebarQuickCreate({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const isEn = locale === "en-US";

  return (
    <PopoverRoot onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger
            aria-label={isEn ? "Quick create" : "Crear rápido"}
            className="glass-inner inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sidebar-foreground/70 transition-all duration-200 hover:bg-white/70 hover:text-sidebar-foreground hover:shadow-sm dark:hover:bg-white/10"
            type="button"
          >
            <Icon icon={Add01Icon} size={16} />
          </PopoverTrigger>
        </TooltipTrigger>
        {!open && (
          <TooltipContent side="top" sideOffset={8}>
            <span className="font-medium text-[11px] text-popover-foreground">
              {isEn ? "Quick create" : "Crear rápido"}
            </span>
          </TooltipContent>
        )}
      </Tooltip>

      <PopoverContent
        align="end"
        className="w-[180px] p-1.5"
        side="top"
        sideOffset={8}
      >
        <p className="px-2 pt-1 pb-1.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
          {isEn ? "Create new" : "Crear nuevo"}
        </p>
        <div className="space-y-0.5">
          {QUICK_CREATE_ITEMS.map((item) => (
            <Link
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-foreground/88 transition-colors hover:bg-muted/70 hover:text-foreground"
              href={item.href}
              key={item.href}
              onClick={() => setOpen(false)}
            >
              <Icon
                className="text-muted-foreground"
                icon={item.icon}
                size={15}
              />
              {item.label[locale]}
            </Link>
          ))}
        </div>
      </PopoverContent>
    </PopoverRoot>
  );
}
