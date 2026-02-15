import type { ReactNode } from "react";

import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { getActiveLocale } from "@/lib/i18n/server";

export default async function TenantLayout({
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
