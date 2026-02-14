"use client";

import {
  KeyboardIcon,
  Menu01Icon,
  MenuCollapseIcon,
} from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { AppBreadcrumbs } from "@/components/shell/app-breadcrumbs";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    <header className="border-border/75 border-b bg-sidebar px-3 py-2.5 backdrop-blur-xl sm:px-4 lg:px-5 xl:px-6">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
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
                "h-9 w-9 rounded-xl border border-transparent text-foreground/62 hover:border-border/80 hover:bg-background hover:text-foreground"
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
            {pathname === "/app" ? (
              <h2 className="truncate font-semibold text-[1.12rem] tracking-[-0.01em] md:text-[1.2rem] lg:text-[1.25rem]">
                {isEn ? "Dashboard" : "Panel"}
              </h2>
            ) : (
              <AppBreadcrumbs className="truncate" locale={locale} />
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-label={isEn ? "Keyboard shortcuts" : "Atajos de teclado"}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "icon" }),
                  "h-9 w-9 rounded-xl border border-transparent text-foreground/62 hover:border-border/80 hover:bg-background hover:text-foreground"
                )}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("pa:show-shortcuts-help")
                  )
                }
                type="button"
              >
                <Icon icon={KeyboardIcon} size={16} />
              </button>
            </TooltipTrigger>
            <TooltipContent
              className="flex items-center gap-2.5 px-2.5 py-1.5"
              side="bottom"
              sideOffset={8}
            >
              <span className="text-[11px] font-medium text-popover-foreground">
                {isEn ? "Keyboard shortcuts" : "Atajos de teclado"}
              </span>
              <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border/80 bg-muted/70 px-1 font-mono text-[10px] font-medium text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
                ?
              </kbd>
            </TooltipContent>
          </Tooltip>
          <ThemeToggle locale={locale} />
          <LanguageSelector />
        </div>
      </div>
    </header>
  );
}
