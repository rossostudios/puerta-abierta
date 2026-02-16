import Link from "next/link";
import type { Locale } from "@/lib/i18n";

export function AppFooter({ locale }: { locale: Locale }) {
  const isEn = locale === "en-US";

  return (
    <footer className="flex h-9 shrink-0 items-center justify-between border-t border-border/40 bg-background px-4 text-[11px] text-muted-foreground/70">
      <div className="flex items-center gap-4">
        <Link className="transition-colors hover:text-foreground" href="/documentation">
          {isEn ? "Docs" : "Docs"}
        </Link>
        <Link className="transition-colors hover:text-foreground" href="/settings">
          {isEn ? "Settings" : "Ajustes"}
        </Link>
      </div>

      <span className="font-[family-name:var(--font-pixel)] text-[12px] tracking-wide text-muted-foreground/50">
        Stoa
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
