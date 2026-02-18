import type { Metadata } from "next";
import { Suspense } from "react";

import { getActiveLocale } from "@/lib/i18n/server";

import { OwnerLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Owner Access | Casaora",
  robots: { index: false, follow: false },
};

export default async function OwnerLoginPage() {
  const locale = await getActiveLocale();
  return (
    <Suspense fallback={null}>
      <OwnerLoginForm locale={locale} />
    </Suspense>
  );
}
