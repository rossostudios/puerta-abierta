"use client";

import {
  GridViewIcon,
  HeartAddIcon,
  Home01Icon,
  InformationCircleIcon,
  Menu01Icon,
  Message01Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { StoaLogo } from "@/components/ui/stoa-logo";
import {
  FAVORITES_CHANGE_EVENT,
  getFavoritesCount,
} from "@/lib/features/marketplace/favorites";
import { cn } from "@/lib/utils";

type HeaderLocale = "es-PY" | "en-US";

type NavItem = {
  href: string;
  icon: typeof Home01Icon;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/",
    icon: Home01Icon,
    label: {
      "es-PY": "Inicio",
      "en-US": "Home",
    },
    match: (pathname) => pathname === "/",
  },
  {
    href: "/marketplace",
    icon: GridViewIcon,
    label: {
      "es-PY": "Propiedades",
      "en-US": "Properties",
    },
    match: (pathname) => pathname.startsWith("/marketplace"),
  },
  {
    href: "/marketplace#how-it-works",
    icon: InformationCircleIcon,
    label: {
      "es-PY": "Cómo funciona",
      "en-US": "How it works",
    },
    match: () => false,
  },
];

export function PublicHeader({ locale }: { locale: HeaderLocale }) {
  const isEn = locale === "en-US";
  const pathname = usePathname();
  const [favCount, setFavCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setFavCount(getFavoritesCount());
    function sync() {
      setFavCount(getFavoritesCount());
    }
    window.addEventListener(FAVORITES_CHANGE_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_CHANGE_EVENT, sync);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-border/70 border-b bg-background/92 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1560px] items-center gap-2.5 px-3 py-3 sm:px-6 lg:px-8">
        {/* Mobile hamburger */}
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/75 bg-card/90 text-muted-foreground transition-colors hover:text-foreground lg:hidden"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <Icon icon={Menu01Icon} size={18} />
          <span className="sr-only">Menu</span>
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-border/75 bg-card/90 px-3 font-semibold text-[0.95rem] tracking-tight transition-colors hover:bg-accent"
            href="/"
          >
            <StoaLogo className="text-primary" size={20} />
            <span className="hidden sm:inline">Stoa</span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-2xl border px-3 font-medium text-sm transition-colors",
                    active
                      ? "border-border bg-card text-foreground"
                      : "border-transparent text-muted-foreground hover:border-border/60 hover:bg-card/70 hover:text-foreground"
                  )}
                  href={item.href}
                  key={`${item.href}-${item.label["en-US"]}`}
                >
                  <Icon icon={item.icon} size={16} />
                  {item.label[locale]}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Separator */}
        <div className="mx-1 hidden h-6 w-px bg-border/60 lg:block" />

        <div className="flex items-center gap-2">
          <Link
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/75 bg-card/90 text-muted-foreground transition-colors hover:text-foreground"
            href="/marketplace"
          >
            <Icon icon={GridViewIcon} size={16} />
            <span className="sr-only">
              {isEn ? "Marketplace" : "Marketplace"}
            </span>
          </Link>

          <Link
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/75 bg-card/90 text-muted-foreground transition-colors hover:text-foreground"
            href="/marketplace/favorites"
          >
            <Icon icon={HeartAddIcon} size={16} />
            {favCount > 0 ? (
              <span className="absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {favCount}
              </span>
            ) : null}
            <span className="sr-only">
              {isEn ? "Favorites" : "Favoritos"}
            </span>
          </Link>

          <Link
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/75 bg-card/90 text-muted-foreground transition-colors hover:text-foreground"
            href="/login"
          >
            <Icon icon={Message01Icon} size={16} />
            <span className="sr-only">{isEn ? "Admin" : "Admin"}</span>
          </Link>

          <LanguageSelector className="hidden h-10 w-[7.25rem] rounded-xl border-border/75 text-xs sm:inline-flex sm:w-[8.4rem]" />

          <Link
            className="hidden h-10 items-center rounded-2xl bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 md:inline-flex"
            href={
              pathname.startsWith("/marketplace") ? "/login" : "/marketplace"
            }
          >
            {pathname.startsWith("/marketplace")
              ? isEn
                ? "Agency login"
                : "Ingreso agencias"
              : isEn
                ? "Explore"
                : "Explorar"}
          </Link>
        </div>
      </div>

      {/* Mobile drawer */}
      <Sheet
        contentClassName="w-[min(85vw,20rem)]"
        onOpenChange={setMobileOpen}
        open={mobileOpen}
        side="left"
        title="Stoa"
      >
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 font-medium text-sm transition-colors",
                  active
                    ? "bg-primary/8 text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
                href={item.href}
                key={`mobile-${item.href}-${item.label["en-US"]}`}
                onClick={() => setMobileOpen(false)}
              >
                <Icon icon={item.icon} size={18} />
                {item.label[locale]}
              </Link>
            );
          })}
        </nav>

        <div className="my-4 h-px bg-border/60" />

        <Link
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 font-medium text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          href="/marketplace/favorites"
          onClick={() => setMobileOpen(false)}
        >
          <Icon icon={HeartAddIcon} size={18} />
          {isEn ? "Favorites" : "Favoritos"}
          {favCount > 0 ? (
            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold text-white">
              {favCount}
            </span>
          ) : null}
        </Link>

        <div className="my-4 h-px bg-border/60" />

        <div className="px-3">
          <LanguageSelector className="h-10 w-full rounded-xl border-border/75 text-xs" />
        </div>

        <div className="mt-4 px-3">
          <Link
            className="flex h-10 w-full items-center justify-center rounded-2xl bg-primary font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            href={
              pathname.startsWith("/marketplace") ? "/login" : "/marketplace"
            }
            onClick={() => setMobileOpen(false)}
          >
            {pathname.startsWith("/marketplace")
              ? isEn
                ? "Agency login"
                : "Ingreso agencias"
              : isEn
                ? "Explore"
                : "Explorar"}
          </Link>
        </div>
      </Sheet>
    </header>
  );
}
