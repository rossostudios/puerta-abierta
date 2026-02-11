"use client";

import { usePathname } from "next/navigation";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { AppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { CommandPalette } from "@/components/shell/command-palette";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import type { Locale } from "@/lib/i18n";

type TopbarProps = {
  orgId: string | null;
  locale: Locale;
};

export function Topbar({ orgId, locale }: TopbarProps) {
  const pathname = usePathname();
  const isEn = locale === "en-US";

  return (
    <header className="border-b bg-background/80 px-4 py-3 backdrop-blur md:px-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          {pathname === "/" ? (
            <h2 className="truncate font-semibold text-lg tracking-tight">
              {isEn ? "Dashboard" : "Panel"}
            </h2>
          ) : (
            <AppBreadcrumbs className="truncate" locale={locale} />
          )}
        </div>
        <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:items-center">
          <div className="flex items-center gap-2">
            <CommandPalette />
            <ThemeToggle locale={locale} />
            <LanguageSelector className="hidden h-9 w-[10rem] md:block" />
          </div>
          <OrgSwitcher activeOrgId={orgId} locale={locale} />
        </div>
      </div>
    </header>
  );
}
