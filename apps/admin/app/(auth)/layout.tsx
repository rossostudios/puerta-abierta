import { Building01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { LanguageSelector } from "@/components/preferences/language-selector";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Icon } from "@/components/ui/icon";
import { getActiveLocale } from "@/lib/i18n/server";

export default async function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  return (
    <div className="flex min-h-screen bg-background">
      {/* ── Left panel ── */}
      <div className="relative flex w-full flex-col lg:w-1/2">
        <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
          <LanguageSelector className="w-[170px] bg-background/70 backdrop-blur" />
          <ThemeToggle locale={locale} />
        </div>

        <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-6 py-20">
          {children}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 text-muted-foreground text-xs">
          <span>
            &copy;{new Date().getFullYear()} Stoa.{" "}
            {isEn ? "All rights reserved." : "Todos los derechos reservados."}
          </span>
          <div className="flex items-center gap-3">
            <Link
              className="transition-colors hover:text-foreground"
              href="#"
            >
              {isEn ? "Privacy Policy" : "Política de privacidad"}
            </Link>
            <span aria-hidden="true">&middot;</span>
            <Link
              className="transition-colors hover:text-foreground"
              href="#"
            >
              {isEn ? "Terms & Conditions" : "Términos y condiciones"}
            </Link>
          </div>
        </footer>
      </div>

      {/* ── Right panel (image placeholder) ── */}
      <div className="hidden items-center justify-center overflow-hidden bg-[#0f1117] p-10 lg:flex lg:w-1/2">
        <div className="flex max-w-lg flex-col items-center gap-10">
          {/* Image placeholder */}
          <div className="relative w-full overflow-hidden rounded-3xl border border-white/[0.06] bg-gradient-to-br from-white/[0.04] to-transparent shadow-2xl">
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-4 p-8">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04]">
                <Icon
                  className="text-white/25"
                  icon={Building01Icon}
                  size={28}
                />
              </div>
              <span className="text-sm text-white/25">Image Placeholder</span>
            </div>
          </div>

          {/* Branding */}
          <div className="text-center">
            <h2 className="text-xl font-semibold text-white">
              {isEn
                ? "Manage Your Properties"
                : "Administra tus propiedades"}
            </h2>
            <p className="mt-2 text-sm text-white/50">
              {isEn
                ? "Short-term rental operations in Paraguay, simplified."
                : "Operaciones de alquiler temporario en Paraguay, simplificadas."}
            </p>
          </div>

          {/* Carousel dots */}
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-white" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
            <span className="h-2 w-2 rounded-full bg-white/20" />
          </div>
        </div>
      </div>
    </div>
  );
}
