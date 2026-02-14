"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getSafeWhatsAppUrl } from "@/lib/security/safe-external-url";

export function WhatsAppContactButton({
  listingSlug,
  whatsappUrl,
  label,
}: {
  listingSlug: string;
  whatsappUrl: string;
  label: string;
}) {
  function onClick() {
    const safeUrl = getSafeWhatsAppUrl(whatsappUrl);
    if (!safeUrl) {
      toast.error("Could not open WhatsApp link");
      return;
    }

    fetch(
      `/api/public/marketplace/listings/${encodeURIComponent(
        listingSlug
      )}/contact-whatsapp`,
      {
        method: "POST",
        keepalive: true,
      }
    ).catch(() => {
      // Ignore telemetry failures.
    });

    if (typeof window !== "undefined") {
      window.open(safeUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Button onClick={onClick} type="button" variant="outline">
      {label}
    </Button>
  );
}
