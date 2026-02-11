"use client";

import { Menu01Icon, MenuCollapseIcon } from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { AppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { CommandPalette } from "@/components/shell/command-palette";
import { OrgSwitcher } from "@/components/shell/org-switcher";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type TopbarProps = {
  orgId: string | null;
  locale: Locale;
  showNavToggle?: boolean;
  onNavToggle?: () => void;
  isNavOpen?: boolean;
};

export function Topbar({
  orgId,
  locale,
  showNavToggle = false,
  onNavToggle,
  isNavOpen = false,
}: TopbarProps) {
  const pathname = usePathname();
  const isEn = locale === "en-US";

  return (
    <header className="border-border/75 border-b bg-background/96 px-3 py-2.5 backdrop-blur sm:px-4 lg:px-5 xl:px-6">
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          {showNavToggle ? (
            <button
              aria-label={
                isNavOpen
                  ? isEn
                    ? "Collapse navigation"
                    : "Colapsar navegación"
                  : isEn
                    ? "Open navigation"
                    : "Abrir navegación"
              }
              className={cn(
                buttonVariants({ variant: "ghost", size: "icon" }),
                "h-9 w-9 rounded-xl text-foreground/68 hover:text-foreground"
              )}
              onClick={onNavToggle}
              type="button"
            >
              <Icon
                icon={isNavOpen ? MenuCollapseIcon : Menu01Icon}
                size={18}
              />
            </button>
          ) : null}

          <div className="min-w-0">
            {pathname === "/" ? (
              <h2 className="truncate font-semibold text-[1.05rem] tracking-tight md:text-[1.1rem] lg:text-[1.18rem]">
                {isEn ? "Dashboard" : "Panel"}
              </h2>
            ) : (
              <AppBreadcrumbs className="truncate" locale={locale} />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
          <CommandPalette />
          <ThemeToggle locale={locale} />
          <LanguageSelector className="hidden h-9 w-[10rem] md:block" />
          <OrgSwitcher activeOrgId={orgId} locale={locale} />
        </div>
      </div>
    </header>
  );
}
