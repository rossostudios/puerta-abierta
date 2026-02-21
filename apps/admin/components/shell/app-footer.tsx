"use client";

import { KeyboardIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { CasaoraLogo } from "@/components/ui/casaora-logo";
import { Icon } from "@/components/ui/icon";
import type { Locale } from "@/lib/i18n";

export function AppFooter({ locale }: { locale: Locale }) {
  const isEn = locale === "en-US";

  return (
    <footer className="glass-chrome glass-edge-top relative flex h-9 shrink-0 items-center justify-between px-4 text-[11px] text-muted-foreground/70">
      <div className="flex items-center gap-4">
        <Link
          className="transition-colors hover:text-foreground"
          href="/documentation"
        >
          {isEn ? "Docs" : "Documentación"}
        </Link>
        <Link
          className="transition-colors hover:text-foreground"
          href="/settings"
        >
          {isEn ? "Settings" : "Ajustes"}
        </Link>
        <button
          className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
          onClick={() =>
            window.dispatchEvent(new CustomEvent("pa:show-shortcuts-help"))
          }
          type="button"
        >
          <Icon icon={KeyboardIcon} size={12} />
          <span className="hidden sm:inline">
            {isEn ? "Shortcuts" : "Atajos"}
          </span>
        </button>
      </div>

      <span className="inline-flex items-center gap-1.5 font-bold text-[11px] text-muted-foreground/70 tracking-wider">
        <CasaoraLogo className="inline-flex" size={14} />
        CASAORA
      </span>

      <div className="flex items-center gap-4">
        <Link className="transition-colors hover:text-foreground" href="/setup">
          {isEn ? "Setup" : "Configuración"}
        </Link>
        <span className="tabular-nums">&copy; {new Date().getFullYear()}</span>
      </div>
    </footer>
  );
}
