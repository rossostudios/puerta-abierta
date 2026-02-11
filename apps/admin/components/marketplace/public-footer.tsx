import Link from "next/link";

export function PublicFooter({ locale }: { locale: "es-PY" | "en-US" }) {
  const isEn = locale === "en-US";

  return (
    <footer className="mt-10 border-border/70 border-t">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-6 px-3 py-8 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:px-8">
        <div className="space-y-2">
          <p className="font-semibold tracking-tight">Puerta Abierta</p>
          <p className="max-w-2xl text-muted-foreground text-sm leading-relaxed">
            {isEn
              ? "Transparent long-term rental marketplace and operations platform for Paraguay agencies and owners."
              : "Marketplace y sistema operativo de alquileres de largo plazo con transparencia para agencias y propietarios en Paraguay."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link
            className="inline-flex h-9 items-center rounded-xl border border-border/70 bg-card/80 px-3 transition-colors hover:bg-accent"
            href="/"
          >
            {isEn ? "Home" : "Inicio"}
          </Link>
          <Link
            className="inline-flex h-9 items-center rounded-xl border border-border/70 bg-card/80 px-3 transition-colors hover:bg-accent"
            href="/marketplace"
          >
            {isEn ? "Listings" : "Anuncios"}
          </Link>
          <Link
            className="inline-flex h-9 items-center rounded-xl border border-border/70 bg-card/80 px-3 transition-colors hover:bg-accent"
            href="/login"
          >
            {isEn ? "Agency admin" : "Admin agencias"}
          </Link>
        </div>
      </div>
    </footer>
  );
}
