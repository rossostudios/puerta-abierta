import {
  Calendar02Icon,
  Location01Icon,
  Search01Icon,
  Wallet02Icon,
} from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";

type MarketplaceHeroProps = {
  isEn: boolean;
  defaultCity?: string;
  defaultMaxBudget?: string;
};

export function MarketplaceHero({
  isEn,
  defaultCity,
  defaultMaxBudget,
}: MarketplaceHeroProps) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-border/60 px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16"
      style={{ background: "var(--marketplace-hero-gradient)" }}
    >
      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <h1 className="font-semibold text-[1.85rem] leading-tight tracking-tight sm:text-[2.5rem] lg:text-[2.9rem]">
          {isEn
            ? "Find your next home in Paraguay"
            : "Encuentra tu próximo hogar en Paraguay"}
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground text-sm sm:text-base">
          {isEn
            ? "Transparent pricing, no hidden fees. Browse long-term rentals with full cost breakdowns."
            : "Precios transparentes, sin costos ocultos. Explora alquileres de largo plazo con desglose completo."}
        </p>

        <form
          action="/marketplace"
          className="mx-auto mt-7 flex max-w-2xl flex-col gap-2 sm:flex-row sm:gap-0 sm:rounded-2xl sm:border sm:border-border/80 sm:bg-background/90 sm:p-1.5 sm:shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
        >
          <label className="inline-flex h-11 flex-1 items-center gap-2 rounded-2xl border border-border/80 bg-background/90 px-3 sm:border-0 sm:bg-transparent">
            <Icon className="text-muted-foreground" icon={Location01Icon} size={16} />
            <input
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              defaultValue={defaultCity}
              name="city"
              placeholder={isEn ? "City" : "Ciudad"}
              type="text"
            />
          </label>

          <div className="hidden w-px self-stretch bg-border/60 sm:block" />

          <label className="inline-flex h-11 flex-1 items-center gap-2 rounded-2xl border border-border/80 bg-background/90 px-3 sm:border-0 sm:bg-transparent">
            <Icon className="text-muted-foreground" icon={Wallet02Icon} size={16} />
            <input
              className="h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
              defaultValue={defaultMaxBudget}
              min={0}
              name="max_monthly"
              placeholder={isEn ? "Max budget/mo" : "Presupuesto max/mes"}
              type="number"
            />
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90 sm:rounded-xl"
            type="submit"
          >
            <Icon icon={Search01Icon} size={16} />
            {isEn ? "Search" : "Buscar"}
          </button>
        </form>
      </div>
    </section>
  );
}
