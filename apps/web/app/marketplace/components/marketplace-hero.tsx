import { Search01Icon } from "@hugeicons/core-free-icons";

import { Icon } from "@/components/ui/icon";
import { CITY_DISPLAY_NAMES } from "@/lib/features/marketplace/geo";

type MarketplaceHeroProps = {
  isEn: boolean;
  defaultCity?: string;
  defaultMaxBudget?: string;
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: search bar uses many ternary operators for i18n
export function MarketplaceHero({
  isEn,
  defaultCity,
  defaultMaxBudget,
}: MarketplaceHeroProps) {
  return (
    <section
      className="relative overflow-hidden rounded-3xl px-5 py-14 sm:px-10 sm:py-24 lg:px-16 lg:py-32"
      style={{ background: "var(--marketplace-hero-gradient)" }}
    >
      <div className="relative z-10 max-w-2xl text-left">
        <h1 className="font-medium font-serif text-4xl text-[var(--marketplace-text)] tracking-tight sm:text-5xl lg:text-7xl lg:leading-[1.1]">
          {isEn
            ? "Find your next home in Paraguay"
            : "Encuentra tu próximo hogar en Paraguay"}
        </h1>
        <p className="mt-6 max-w-xl text-[var(--marketplace-text-muted)] text-lg sm:text-xl">
          {isEn
            ? "Transparent pricing, no hidden fees. Browse long-term rentals with full cost breakdowns."
            : "Precios transparentes, sin costos ocultos. Explora alquileres de largo plazo con desglose completo."}
        </p>
      </div>

      <form
        action="/marketplace"
        className="relative z-10 mt-10 flex w-full max-w-5xl flex-col gap-3 lg:flex-row lg:gap-0 lg:rounded-full lg:border lg:border-[#e8e4df]/80 lg:bg-white/60 lg:p-2 lg:shadow-[0_16px_40px_rgba(0,0,0,0.06)] lg:backdrop-blur-md"
      >
          <label className="group relative flex h-14 flex-col justify-center rounded-2xl border border-[#e8e4df]/80 bg-white/60 px-5 backdrop-blur-md transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--marketplace-text)]/10 hover:bg-white/80 lg:h-16 lg:flex-1 lg:rounded-full lg:border-0 lg:bg-transparent lg:px-6 lg:backdrop-blur-none lg:hover:bg-black/5 lg:focus-within:bg-black/5 lg:focus-within:ring-0">
            <span className="font-semibold text-[10px] text-[var(--marketplace-text)] uppercase tracking-wider">
              {isEn ? "Location" : "Ubicación"}
            </span>
            <select
              className="w-full cursor-pointer appearance-none bg-transparent font-medium text-[var(--marketplace-text-muted)] outline-none"
              defaultValue={defaultCity}
              name="city"
            >
              <option value="">{isEn ? "All cities" : "Todas"}</option>
              {Object.entries(CITY_DISPLAY_NAMES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="hidden w-px self-stretch bg-[#e8e4df]/80 lg:my-2 lg:block" />

          <label className="group relative flex h-14 flex-col justify-center rounded-2xl border border-[#e8e4df]/80 bg-white/60 px-5 backdrop-blur-md transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--marketplace-text)]/10 hover:bg-white/80 lg:h-16 lg:w-44 lg:flex-none lg:rounded-full lg:border-0 lg:bg-transparent lg:px-6 lg:backdrop-blur-none lg:hover:bg-black/5 lg:focus-within:bg-black/5 lg:focus-within:ring-0">
            <span className="font-semibold text-[10px] text-[var(--marketplace-text)] uppercase tracking-wider">
              {isEn ? "Type" : "Tipo"}
            </span>
            <select
              className="w-full cursor-pointer appearance-none bg-transparent font-medium text-[var(--marketplace-text-muted)] outline-none"
              name="property_type"
            >
              <option value="">{isEn ? "Any" : "Cualquier"}</option>
              <option value="apartment">{isEn ? "Apartment" : "Depto"}</option>
              <option value="house">{isEn ? "House" : "Casa"}</option>
              <option value="studio">{isEn ? "Studio" : "Monoambiente"}</option>
              <option value="shared_room">
                {isEn ? "Shared Room" : "Habitación"}
              </option>
            </select>
          </label>

          <div className="hidden w-px self-stretch bg-[#e8e4df]/80 lg:my-2 lg:block" />

          <label className="group relative flex h-14 flex-col justify-center rounded-2xl border border-[#e8e4df]/80 bg-white/60 px-5 backdrop-blur-md transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--marketplace-text)]/10 hover:bg-white/80 lg:h-16 lg:w-36 lg:flex-none lg:rounded-full lg:border-0 lg:bg-transparent lg:px-6 lg:backdrop-blur-none lg:hover:bg-black/5 lg:focus-within:bg-black/5 lg:focus-within:ring-0">
            <span className="font-semibold text-[10px] text-[var(--marketplace-text)] uppercase tracking-wider">
              {isEn ? "Move-In" : "Ingreso"}
            </span>
            <select
              className="w-full cursor-pointer appearance-none bg-transparent font-medium text-[var(--marketplace-text-muted)] outline-none"
              name="available_now"
            >
              <option value="">{isEn ? "Flexible" : "Flexible"}</option>
              <option value="true">
                {isEn ? "Available Now" : "Ya disponible"}
              </option>
            </select>
          </label>

          <div className="hidden w-px self-stretch bg-[#e8e4df]/80 lg:my-2 lg:block" />

          <label className="group relative flex h-14 flex-col justify-center rounded-2xl border border-[#e8e4df]/80 bg-white/60 px-5 backdrop-blur-md transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--marketplace-text)]/10 hover:bg-white/80 lg:h-16 lg:w-40 lg:flex-none lg:rounded-full lg:border-0 lg:bg-transparent lg:px-6 lg:backdrop-blur-none lg:hover:bg-black/5 lg:focus-within:bg-black/5 lg:focus-within:ring-0">
            <span className="font-semibold text-[10px] text-[var(--marketplace-text)] uppercase tracking-wider">
              {isEn ? "Duration" : "Duración"}
            </span>
            <select
              className="w-full cursor-pointer appearance-none bg-transparent font-medium text-[var(--marketplace-text-muted)] outline-none"
              name="max_lease_months"
            >
              <option value="">{isEn ? "Any" : "Cualquier"}</option>
              <option value="1">{isEn ? "1 Month" : "1 Mes"}</option>
              <option value="3">
                {isEn ? "Up to 3 Months" : "Hasta 3 Meses"}
              </option>
              <option value="6">
                {isEn ? "Up to 6 Months" : "Hasta 6 Meses"}
              </option>
              <option value="12">
                {isEn ? "Up to 12 Months" : "Hasta 12 Meses"}
              </option>
            </select>
          </label>

          <div className="hidden w-px self-stretch bg-[#e8e4df]/80 lg:my-2 lg:block" />

          <div className="relative flex flex-col gap-3 lg:flex-1 lg:flex-row lg:items-center lg:gap-0 lg:pl-0">
            <label className="group relative flex h-14 w-full flex-col justify-center rounded-2xl border border-[#e8e4df]/80 bg-white/60 px-5 backdrop-blur-md transition-colors focus-within:bg-white focus-within:ring-2 focus-within:ring-[var(--marketplace-text)]/10 hover:bg-white/80 lg:h-16 lg:rounded-full lg:border-0 lg:bg-transparent lg:px-6 lg:pr-20 lg:backdrop-blur-none lg:hover:bg-black/5 lg:focus-within:bg-black/5 lg:focus-within:ring-0">
              <span className="font-semibold text-[10px] text-[var(--marketplace-text)] uppercase tracking-wider">
                {isEn ? "Max Rent" : "Alquiler Max"}
              </span>
              <input
                className="w-full appearance-none bg-transparent font-medium text-[var(--marketplace-text-muted)] outline-none placeholder:truncate placeholder:font-normal placeholder:text-[var(--marketplace-text-muted)]/50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                defaultValue={defaultMaxBudget}
                min={0}
                name="max_monthly"
                placeholder={isEn ? "Add amount" : "Monto"}
                type="number"
              />
            </label>

            {/* Desktop Button */}
            <button
              className="absolute top-1/2 right-2 hidden h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--marketplace-text)] text-[var(--marketplace-bg)] shadow-sm transition-all duration-300 ease-out hover:scale-[1.05] hover:opacity-90 active:scale-[0.95] lg:flex"
              type="submit"
            >
              <Icon icon={Search01Icon} size={20} />
            </button>

            {/* Mobile Button */}
            <button
              className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--marketplace-text)] font-medium text-[var(--marketplace-bg)] shadow-sm transition-all duration-300 ease-out hover:opacity-90 active:scale-[0.98] lg:hidden"
              type="submit"
            >
              <Icon icon={Search01Icon} size={20} />
              <span>{isEn ? "Search" : "Buscar"}</span>
            </button>
          </div>
      </form>
    </section>
  );
}
