import type { Metadata } from "next";

import { getActiveLocale } from "@/lib/i18n/server";

import { TenantLoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Acceso Inquilino | Stoa",
  robots: { index: false, follow: false },
};

export default async function TenantLoginPage() {
  const locale = await getActiveLocale();
  return <TenantLoginForm locale={locale} />;
}
