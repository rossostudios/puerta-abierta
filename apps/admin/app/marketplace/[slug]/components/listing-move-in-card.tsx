import Link from "next/link";

import { WhatsAppContactButton } from "@/components/marketplace/whatsapp-contact-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";
import { cn } from "@/lib/utils";

import { ScheduleVisitButton } from "./schedule-visit-button";

type ListingMoveInCardProps = {
  slug: string;
  isEn: boolean;
  listing: MarketplaceListingViewModel;
};

export function ListingMoveInCard({ slug, isEn, listing }: ListingMoveInCardProps) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{isEn ? "Move-in summary" : "Resumen de ingreso"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-2.5">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {isEn ? "Total move-in" : "Costo total de ingreso"}
          </p>
          <p className="font-semibold text-2xl">{listing.totalMoveInLabel}</p>
          {listing.totalMoveInUsdApprox ? (
            <p className="text-muted-foreground text-xs">
              {listing.totalMoveInUsdApprox}
            </p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {isEn ? "Monthly recurring" : "Mensual recurrente"}: {listing.monthlyRecurringLabel}
          </p>
          {listing.monthlyRecurringUsdApprox ? (
            <p className="text-muted-foreground text-[11px]">
              {listing.monthlyRecurringUsdApprox}
            </p>
          ) : null}
          {listing.maintenanceFee > 0 ? (
            <p className="text-muted-foreground text-xs">
              {isEn ? "Maintenance fee" : "Costo de mantenimiento"}: {" "}
              {listing.maintenanceFeeLabel}
            </p>
          ) : null}
        </div>

        <Link
          className={cn(buttonVariants({ variant: "default", size: "sm" }), "w-full")}
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
            <ScheduleVisitButton
              isEn={isEn}
              listing={listing}
              slug={slug}
            />
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
