"use client";

import { Button } from "@/components/ui/button";

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
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Button onClick={onClick} type="button" variant="outline">
      {label}
    </Button>
  );
}
