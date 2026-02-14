"use client";

import { WhatsappIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { Icon } from "@/components/ui/icon";
import { getSafeWhatsAppUrl } from "@/lib/security/safe-external-url";

type ListingMobileCtaProps = {
  slug: string;
  monthlyLabel: string;
  whatsappUrl: string;
  isEn: boolean;
};

export function ListingMobileCta({
  slug,
  monthlyLabel,
  whatsappUrl,
  isEn,
}: ListingMobileCtaProps) {
  const safeWhatsApp = getSafeWhatsAppUrl(whatsappUrl);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-border/70 border-t bg-background/95 px-4 py-3 backdrop-blur-md lg:hidden">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-base leading-tight tracking-tight">
            {monthlyLabel}
            <span className="font-normal text-muted-foreground text-xs">
              {" "}
              /{isEn ? "month" : "mes"}
            </span>
          </p>
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
              <span className="hidden sm:inline">WhatsApp</span>
            </a>
          ) : null}
          <Link
            className="inline-flex h-10 items-center rounded-xl bg-primary px-5 font-medium text-primary-foreground text-sm transition-colors hover:bg-primary/90"
            href={`/marketplace/apply/${encodeURIComponent(slug)}`}
          >
            {isEn ? "Apply" : "Aplicar"}
          </Link>
        </div>
      </div>
    </div>
  );
}
