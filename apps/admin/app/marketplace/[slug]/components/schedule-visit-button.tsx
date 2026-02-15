"use client";

import { Button } from "@/components/ui/button";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import { getSafeWhatsAppUrl } from "@/lib/security/safe-external-url";

type ScheduleVisitButtonProps = {
  slug: string;
  isEn: boolean;
  listing: MarketplaceListingViewModel;
};

export function ScheduleVisitButton({
  slug,
  isEn,
  listing,
}: ScheduleVisitButtonProps) {
  function onClick() {
    const baseUrl = listing.whatsappUrl.split("?")[0] ?? listing.whatsappUrl;
    const message = isEn
      ? `Hi! I'd like to schedule a visit for "${listing.title}" in ${listing.city}. When is a good time?`
      : `¡Hola! Me gustaría agendar una visita para "${listing.title}" en ${listing.city}. ¿Cuándo sería un buen momento?`;
    const visitUrl = `${baseUrl}?text=${encodeURIComponent(message)}`;
    const safeUrl = getSafeWhatsAppUrl(visitUrl);
    if (safeUrl && typeof window !== "undefined") {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Button
      className="w-full"
      onClick={onClick}
      type="button"
      variant="outline"
    >
      {isEn ? "Schedule a visit" : "Agendar una visita"}
    </Button>
  );
}
