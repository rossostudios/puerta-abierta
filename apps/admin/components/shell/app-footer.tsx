"use client";

import Link from "next/link";

import type { Locale } from "@/lib/i18n";

export function AppFooter({ locale }: { locale: Locale }) {
  const isEn = locale === "en-US";

  return (
    <footer className="relative flex h-9 shrink-0 items-center justify-between border-t border-sidebar-border/60 bg-sidebar px-4 text-[11px] text-sidebar-foreground/60">
      <div className="flex items-center gap-4">
        <Link
          className="transition-colors hover:text-sidebar-foreground"
          href="/privacy"
        >
          {isEn ? "Privacy" : "Privacidad"}
        </Link>
        <Link
          className="transition-colors hover:text-sidebar-foreground"
          href="/terms"
        >
          {isEn ? "Terms" : "Términos"}
        </Link>
        <Link
          className="transition-colors hover:text-sidebar-foreground"
          href="/changelog"
        >
          Changelog
        </Link>
      </div>

      <div className="flex items-center gap-1">
        <span className="tabular-nums">&copy; {new Date().getFullYear()}</span>
        <a
          className="transition-colors hover:text-sidebar-foreground"
          href="https://casaora.co"
          rel="noopener noreferrer"
          target="_blank"
        >
          Casaora
        </a>
        <span>·</span>
        <span>{isEn ? "All rights reserved" : "Todos los derechos reservados"}</span>
      </div>
    </footer>
  );
}
