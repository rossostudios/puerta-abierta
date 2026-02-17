import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { getActiveLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  manifest: "/manifest.json",
  other: {
    "apple-mobile-web-app-capable": "yes",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    "apple-mobile-web-app-title": "Casaora",
  },
};

export default async function GuestLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getActiveLocale();

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <PublicHeader locale={locale} />
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        {children}
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
