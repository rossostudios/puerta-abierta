"use client";

import { HeartAddIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { CasaoraLogo } from "@/components/ui/casaora-logo";
import { LanguageSelector } from "@/components/preferences/language-selector";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import {
  FAVORITES_CHANGE_EVENT,
  getFavoritesCount,
} from "@/lib/features/marketplace/favorites";
import { cn } from "@/lib/utils";

function subscribeFavorites(onStoreChange: () => void) {
  window.addEventListener(FAVORITES_CHANGE_EVENT, onStoreChange);
  return () =>
    window.removeEventListener(FAVORITES_CHANGE_EVENT, onStoreChange);
}
function getServerFavCount() {
  return 0;
}

type HeaderLocale = "es-PY" | "en-US";

type NavItem = {
  href: string;
  label: {
    "es-PY": string;
    "en-US": string;
  };
  match: (pathname: string) => boolean;
};

const NAV_ITEMS: readonly NavItem[] = [
  {
    href: "/marketplace",
    label: {
      "es-PY": "Propiedades",
      "en-US": "Properties",
    },
    match: (pathname) => pathname === "/marketplace",
  },
  {
    href: "/marketplace#how-it-works",
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
  const favCount = useSyncExternalStore(
    subscribeFavorites,
    getFavoritesCount,
    getServerFavCount
  );
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-[#e8e4df] border-b bg-[var(--marketplace-bg)]/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1560px] items-center gap-4 px-4 py-4 sm:px-6 lg:px-8">
        {/* Mobile hamburger */}
        <button
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-[var(--marketplace-text-muted)] transition-colors hover:text-[var(--marketplace-text)] lg:hidden"
          onClick={() => setMobileOpen(true)}
          type="button"
        >
          <Icon icon={Menu01Icon} size={20} />
          <span className="sr-only">Menu</span>
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-6">
          <Link
            className="inline-flex items-center gap-2.5 transition-opacity hover:opacity-80"
            href="/"
          >
            <CasaoraLogo className="inline-flex" size={28} />
            <span className="font-bold text-[var(--marketplace-text)] text-xl tracking-tight">
              CASAORA
            </span>
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  className={cn(
                    "relative px-3 py-2 font-medium text-sm transition-colors",
                    active
                      ? "text-primary"
                      : "text-[var(--marketplace-text-muted)] hover:text-primary"
                  )}
                  href={item.href}
                  key={`${item.href}-${item.label["en-US"]}`}
                >
                  {item.label[locale]}
                  {active ? (
                    <span className="absolute inset-x-3 -bottom-4 h-0.5 rounded-full bg-primary" />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <Link
            className="relative inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--marketplace-text-muted)] transition-colors hover:text-primary"
            href="/marketplace/favorites"
          >
            <Icon icon={HeartAddIcon} size={18} />
            {favCount > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-bold text-[9px] text-white">
                {favCount}
              </span>
            ) : null}
            <span className="sr-only">{isEn ? "Favorites" : "Favoritos"}</span>
          </Link>

          <LanguageSelector className="hidden h-9 w-[7.25rem] rounded-xl border-[#e8e4df] bg-transparent text-xs sm:inline-flex sm:w-[8.4rem]" />

          <Link
            className="hidden h-10 items-center rounded-xl bg-casaora-gradient-warm px-5 font-medium text-sm text-white transition-opacity hover:opacity-90 md:inline-flex"
            href={
              pathname.startsWith("/marketplace") ? "/login" : "/marketplace"
            }
          >
            {pathname.startsWith("/marketplace")
              ? isEn
                ? "List your property"
                : "Publica tu propiedad"
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
        title="Casaora"
      >
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2.5 font-medium text-sm transition-colors",
                  active
                    ? "text-primary"
                    : "text-[var(--marketplace-text-muted)] hover:text-primary"
                )}
                href={item.href}
                key={`mobile-${item.href}-${item.label["en-US"]}`}
                onClick={() => setMobileOpen(false)}
              >
                {item.label[locale]}
              </Link>
            );
          })}
        </nav>

        <div className="my-4 h-px bg-[#e8e4df]" />

        <Link
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 font-medium text-[var(--marketplace-text-muted)] text-sm transition-colors hover:text-primary"
          href="/marketplace/favorites"
          onClick={() => setMobileOpen(false)}
        >
          <Icon icon={HeartAddIcon} size={18} />
          {isEn ? "Favorites" : "Favoritos"}
          {favCount > 0 ? (
            <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-bold text-[10px] text-white">
              {favCount}
            </span>
          ) : null}
        </Link>

        <div className="my-4 h-px bg-[#e8e4df]" />

        <div className="px-3">
          <LanguageSelector className="h-10 w-full rounded-xl border-[#e8e4df] text-xs" />
        </div>

        <div className="mt-4 px-3">
          <Link
            className="flex h-10 w-full items-center justify-center rounded-xl bg-casaora-gradient-warm font-medium text-sm text-white transition-opacity hover:opacity-90"
            href={
              pathname.startsWith("/marketplace") ? "/login" : "/marketplace"
            }
            onClick={() => setMobileOpen(false)}
          >
            {pathname.startsWith("/marketplace")
              ? isEn
                ? "List your property"
                : "Publica tu propiedad"
              : isEn
                ? "Explore"
                : "Explorar"}
          </Link>
        </div>
      </Sheet>
    </header>
  );
}
