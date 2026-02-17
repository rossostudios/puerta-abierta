import type { Metadata } from "next";

import { getActiveLocale } from "@/lib/i18n/server";

import { GuestLoginForm } from "./guest-login-form";

export const metadata: Metadata = {
  title: "Acceso Huésped | Casaora",
  robots: { index: false, follow: false },
};

export default async function GuestLoginPage() {
  const locale = await getActiveLocale();
  return <GuestLoginForm locale={locale} />;
}
