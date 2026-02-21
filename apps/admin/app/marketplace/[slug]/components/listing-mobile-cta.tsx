"use client";

import { WhatsappIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { getSafeWhatsAppUrl } from "@/lib/security/safe-external-url";

type ListingMobileCtaProps = {
  slug: string;
  monthlyLabel: string;
  monthlyUsdApprox?: string | null;
  whatsappUrl: string;
  isEn: boolean;
  bookingUrl?: string | null;
};

export function ListingMobileCta({
  slug,
  monthlyLabel,
  monthlyUsdApprox,
  whatsappUrl,
  isEn,
  bookingUrl,
}: ListingMobileCtaProps) {
  const safeWhatsApp = getSafeWhatsAppUrl(whatsappUrl);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-[#e8e4df] border-t bg-[var(--marketplace-bg)]/95 px-4 py-3 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium font-serif text-[var(--marketplace-text)] text-base tracking-tight">
            {monthlyLabel}
            <span className="font-normal font-sans text-[var(--marketplace-text-muted)] text-xs">
              {" "}
              /{isEn ? "month" : "mes"}
            </span>
          </p>
          {monthlyUsdApprox ? (
            <p className="text-[11px] text-[var(--marketplace-text-muted)]">
              {monthlyUsdApprox}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {safeWhatsApp ? (
            <a
              aria-label="WhatsApp"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#25D366] px-3.5 font-medium text-sm text-white transition-colors hover:bg-[#25D366]/90"
              href={safeWhatsApp}
              rel="noopener noreferrer"
              target="_blank"
            >
              <Icon icon={WhatsappIcon} size={16} />
              <span>WhatsApp</span>
            </a>
          ) : null}
          {bookingUrl ? (
            <Link
              className="inline-flex h-10 items-center rounded-xl bg-casaora-gradient-warm px-5 font-medium text-sm text-white transition-opacity hover:opacity-90"
              href={bookingUrl}
            >
              {isEn ? "Book" : "Reservar"}
            </Link>
          ) : (
            <Link
              className="inline-flex h-10 items-center rounded-xl bg-casaora-gradient-warm px-5 font-medium text-sm text-white transition-opacity hover:opacity-90"
              href={`/marketplace/apply/${encodeURIComponent(slug)}`}
            >
              {isEn ? "Apply" : "Aplicar"}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
