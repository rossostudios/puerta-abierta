import type { Metadata } from "next";
import { Suspense } from "react";

import { getActiveLocale } from "@/lib/i18n/server";

import { TenantLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Acceso Inquilino | Casaora",
  robots: { index: false, follow: false },
};

export default async function TenantLoginPage() {
  const locale = await getActiveLocale();
  return (
    <Suspense fallback={null}>
      <TenantLoginForm locale={locale} />
    </Suspense>
  );
}
