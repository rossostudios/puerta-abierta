import type { Metadata } from "next";

import { getActiveLocale } from "@/lib/i18n/server";

import { TenantPayments } from "./tenant-payments";

export const metadata: Metadata = {
  title: "Pagos | Portal del Inquilino | Puerta Abierta",
  robots: { index: false, follow: false },
};

export default async function TenantPaymentsPage() {
  const locale = await getActiveLocale();
  return <TenantPayments locale={locale} />;
}
