import type { Metadata } from "next";

import { getActiveLocale } from "@/lib/i18n/server";

import { TenantMaintenance } from "./tenant-maintenance";

export const metadata: Metadata = {
  title: "Mantenimiento | Portal del Inquilino | Puerta Abierta",
  robots: { index: false, follow: false },
};

export default async function TenantMaintenancePage() {
  const locale = await getActiveLocale();
  return <TenantMaintenance locale={locale} />;
}
