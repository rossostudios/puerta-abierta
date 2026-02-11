"use client";

import {
  Calendar02Icon,
  GridViewIcon,
  Home01Icon,
  Message01Icon,
  UserGroupIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { Icon } from "@/components/ui/icon";
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
    href: "/marketplace",
    icon: UserGroupIcon,
    label: {
      "es-PY": "Clientes",
      "en-US": "Clients",
    },
    match: () => false,
  },
  {
    href: "/marketplace",
    icon: Calendar02Icon,
    label: {
      "es-PY": "Novedades",
      "en-US": "Updates",
    },
    match: () => false,
  },
];

export function PublicHeader({ locale }: { locale: HeaderLocale }) {
  const isEn = locale === "en-US";
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-border/70 border-b bg-background/92 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1560px] items-center justify-between gap-3 px-3 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            className="inline-flex h-11 items-center gap-2 rounded-2xl border border-border/75 bg-card/90 px-3 font-semibold text-[0.95rem] tracking-tight transition-colors hover:bg-accent"
            href="/"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary/12 text-primary text-xs">
              PA
            </span>
            <span className="hidden sm:inline">Puerta Abierta</span>
          </Link>

          <nav className="hidden items-center gap-1 xl:flex">
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
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/75 bg-card/90 text-muted-foreground transition-colors hover:text-foreground"
            href="/login"
          >
            <Icon icon={Message01Icon} size={16} />
            <span className="sr-only">{isEn ? "Admin" : "Admin"}</span>
          </Link>

          <LanguageSelector className="h-10 w-[8.4rem] rounded-xl border-border/75 text-xs" />

          <Link
            className="hidden h-10 items-center rounded-2xl bg-primary px-4 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 sm:inline-flex"
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
    </header>
  );
}
