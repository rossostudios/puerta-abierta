import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";

type ListingFeesCardProps = {
  isEn: boolean;
  listing: MarketplaceListingViewModel;
};

export function ListingFeesCard({ isEn, listing }: ListingFeesCardProps) {
  const oneTimeFees = listing.feeLines.filter(
    (l) => l.feeType === "one_time" || l.feeType === "deposit" || l.feeType === "move_in"
  );
  const recurringFees = listing.feeLines.filter(
    (l) => l.feeType === "recurring" || l.feeType === "monthly"
  );
  // Anything that doesn't fit cleanly
  const otherFees = listing.feeLines.filter(
    (l) =>
      !oneTimeFees.includes(l) && !recurringFees.includes(l)
  );

  // If we can't categorize, show them all together
  const canCategorize = oneTimeFees.length > 0 || recurringFees.length > 0;

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          {isEn ? "Transparent fee breakdown" : "Desglose transparente"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {canCategorize ? (
          <>
            {oneTimeFees.length > 0 ? (
              <div>
                <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Move-in costs (one-time)" : "Costos de ingreso (una vez)"}
                </p>
                <div className="space-y-2">
                  {oneTimeFees.map((line) => (
                    <FeeLineRow
                      key={line.key}
                      label={line.label}
                      amount={line.amountLabel}
                      feeType={line.feeType}
                      isEn={isEn}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between border-t border-border/50 pt-2 text-sm font-semibold">
                  <span>{isEn ? "Move-in total" : "Total ingreso"}</span>
                  <span>{listing.totalMoveInLabel}</span>
                </div>
              </div>
            ) : null}

            {recurringFees.length > 0 ? (
              <div>
                <p className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {isEn ? "Monthly recurring" : "Mensual recurrente"}
                </p>
                <div className="space-y-2">
                  {recurringFees.map((line) => (
                    <FeeLineRow
                      key={line.key}
                      label={line.label}
                      amount={line.amountLabel}
                      feeType={line.feeType}
                      isEn={isEn}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between border-t border-border/50 pt-2 text-sm font-semibold">
                  <span>{isEn ? "Monthly total" : "Total mensual"}</span>
                  <span>{listing.monthlyRecurringLabel}</span>
                </div>
              </div>
            ) : null}

            {otherFees.length > 0 ? (
              <div className="space-y-2">
                {otherFees.map((line) => (
                  <FeeLineRow
                    key={line.key}
                    label={line.label}
                    amount={line.amountLabel}
                    feeType={line.feeType}
                    isEn={isEn}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <>
            {listing.feeLines.map((line) => (
              <FeeLineRow
                key={line.key}
                label={line.label}
                amount={line.amountLabel}
                feeType={line.feeType}
                isEn={isEn}
              />
            ))}
            {listing.feeLines.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "No fee lines configured yet."
                  : "Todavía no hay líneas de costo configuradas."}
              </p>
            ) : null}
          </>
        )}

        <div className="rounded-xl border border-border/70 bg-muted/15 p-3">
          <p className="mb-2 font-medium text-sm">
            {isEn ? "Rental details" : "Detalles del alquiler"}
          </p>
          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <p>
              {isEn ? "Property type" : "Tipo"}:{" "}
              <span className="text-muted-foreground">
                {listing.propertyType || (isEn ? "Not set" : "Sin definir")}
              </span>
            </p>
            <p>
              {isEn ? "Furnished" : "Amoblado"}:{" "}
              <span className="text-muted-foreground">
                {listing.furnished ? (isEn ? "Yes" : "Sí") : isEn ? "No" : "No"}
              </span>
            </p>
            <p>
              {isEn ? "Parking spaces" : "Estacionamiento"}:{" "}
              <span className="text-muted-foreground">{listing.parkingSpaces ?? 0}</span>
            </p>
            <p>
              {isEn ? "Minimum lease" : "Contrato mínimo"}:{" "}
              <span className="text-muted-foreground">
                {listing.minimumLeaseMonths
                  ? `${listing.minimumLeaseMonths} ${isEn ? "months" : "meses"}`
                  : isEn
                    ? "Not set"
                    : "Sin definir"}
              </span>
            </p>
            <p>
              {isEn ? "Available from" : "Disponible desde"}:{" "}
              <span className="text-muted-foreground">
                {listing.availableFrom || (isEn ? "Not set" : "Sin definir")}
              </span>
            </p>
            <p>
              {isEn ? "Pet policy" : "Mascotas"}:{" "}
              <span className="text-muted-foreground">
                {listing.petPolicy || (isEn ? "Not set" : "Sin definir")}
              </span>
            </p>
          </div>
          {listing.amenities.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {listing.amenities.map((amenity) => (
                <Badge key={amenity} variant="outline">
                  {amenity}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function FeeLineRow({
  label,
  amount,
  feeType,
  isEn,
}: {
  label: string;
  amount: string;
  feeType: string;
  isEn: boolean;
}) {
  const isRefundable = feeType === "deposit";

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="line-clamp-2 font-medium">{label}</p>
        {isRefundable ? (
          <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            {isEn ? "Refundable" : "Reembolsable"}
          </span>
        ) : null}
      </div>
      <p className="shrink-0 text-right font-medium">{amount}</p>
    </div>
  );
}
