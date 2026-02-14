"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MarketplaceApplyFeedback } from "./components/marketplace-apply-feedback";
import { MarketplaceApplyFields } from "./components/marketplace-apply-fields";
import { useMarketplaceApplyForm } from "./hooks/use-marketplace-apply-form";

type MarketplaceApplyFormProps = {
  listingSlug: string;
  locale: "es-PY" | "en-US";
};

export function MarketplaceApplyForm({
  listingSlug,
  locale,
}: MarketplaceApplyFormProps) {
  const isEn = locale === "en-US";
  const { form, error, isSubmitting, successId, onSubmit, updateField } =
    useMarketplaceApplyForm({
      listingSlug,
      locale,
    });

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{isEn ? "Apply" : "Aplicar"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Complete this form for qualification and direct follow-up."
            : "Completa este formulario para calificación y seguimiento directo."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="min-w-0 space-y-4" onSubmit={onSubmit}>
          <MarketplaceApplyFields
            form={form}
            isEn={isEn}
            locale={locale}
            onFieldChange={updateField}
          />
          <MarketplaceApplyFeedback
            error={error}
            isEn={isEn}
            isSubmitting={isSubmitting}
            successId={successId}
          />
        </form>
      </CardContent>
    </Card>
  );
}
