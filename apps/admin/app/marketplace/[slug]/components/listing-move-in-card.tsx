import Link from "next/link";

import { WhatsAppContactButton } from "@/components/marketplace/whatsapp-contact-button";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";

import { ScheduleVisitButton } from "./schedule-visit-button";

type ListingMoveInCardProps = {
  slug: string;
  isEn: boolean;
  listing: MarketplaceListingViewModel;
};

export function ListingMoveInCard({
  slug,
  isEn,
  listing,
}: ListingMoveInCardProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-[var(--marketplace-card-shadow)]">
      <div className="mb-5">
        <p className="font-medium font-serif text-3xl text-[var(--marketplace-text)] tracking-tight">
          {listing.monthlyRecurringLabel}
        </p>
        <p className="text-[var(--marketplace-text-muted)] text-xs">
          /{isEn ? "month" : "mes"}
        </p>
        {listing.monthlyRecurringUsdApprox ? (
          <p className="mt-1 text-[var(--marketplace-text-muted)] text-xs">
            {listing.monthlyRecurringUsdApprox}
          </p>
        ) : null}
      </div>

      <div className="mb-5 rounded-xl bg-[var(--marketplace-bg-muted)] px-4 py-3">
        <p className="text-[var(--marketplace-text-muted)] text-xs">
          {isEn ? "Total move-in" : "Costo total de ingreso"}
        </p>
        <p className="font-semibold text-[var(--marketplace-text)] text-lg">
          {listing.totalMoveInLabel}
        </p>
        {listing.totalMoveInUsdApprox ? (
          <p className="text-[var(--marketplace-text-muted)] text-xs">
            {listing.totalMoveInUsdApprox}
          </p>
        ) : null}
        {listing.maintenanceFee > 0 ? (
          <p className="mt-1 text-[var(--marketplace-text-muted)] text-xs">
            {isEn ? "Maintenance fee" : "Costo de mantenimiento"}:{" "}
            {listing.maintenanceFeeLabel}
          </p>
        ) : null}
      </div>

      <div className="space-y-3">
        <Link
          className="flex h-11 w-full items-center justify-center rounded-xl bg-casaora-gradient-warm font-medium text-sm text-white transition-opacity hover:opacity-90"
          href={`/marketplace/apply/${encodeURIComponent(slug)}`}
        >
          {isEn ? "Apply now" : "Aplicar ahora"}
        </Link>

        {listing.whatsappUrl ? (
          <>
            <WhatsAppContactButton
              label={isEn ? "Contact via WhatsApp" : "Contactar por WhatsApp"}
              listingSlug={slug}
              whatsappUrl={listing.whatsappUrl}
            />
            <ScheduleVisitButton isEn={isEn} listing={listing} />
          </>
        ) : null}
      </div>
    </div>
  );
}
