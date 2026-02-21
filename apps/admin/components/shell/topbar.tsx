"use client";

import { Menu01Icon, MenuCollapseIcon } from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";

import { AppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type TopbarProps = {
  locale: Locale;
  showNavToggle?: boolean;
  onNavToggle?: () => void;
  isNavOpen?: boolean;
};

export function Topbar({
  locale,
  showNavToggle = false,
  onNavToggle,
  isNavOpen = false,
}: TopbarProps) {
  const pathname = usePathname();
  const isEn = locale === "en-US";

  return (
    <header className="glass-chrome sticky top-0 z-20 px-3 py-2.5 sm:px-4 lg:px-5 xl:px-6">
      <div className="flex items-center gap-2.5">
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
              "h-9 w-9 rounded-xl border border-transparent text-muted-foreground hover:border-border/80 hover:bg-muted hover:text-foreground"
            )}
            onClick={onNavToggle}
            type="button"
          >
            <Icon icon={isNavOpen ? MenuCollapseIcon : Menu01Icon} size={18} />
          </button>
        ) : null}

        <div className="min-w-0">
          {pathname === "/app" ? (
            <h2 className="truncate font-semibold text-base md:text-lg">
              {isEn ? "Dashboard" : "Panel"}
            </h2>
          ) : (
            <AppBreadcrumbs className="truncate" locale={locale} />
          )}
        </div>
      </div>
    </header>
  );
}
