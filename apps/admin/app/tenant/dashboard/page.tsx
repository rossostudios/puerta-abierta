import type { Metadata } from "next";

import { getActiveLocale } from "@/lib/i18n/server";

import { TenantDashboard } from "./tenant-dashboard";

export const metadata: Metadata = {
  title: "Mi Portal | Stoa",
  robots: { index: false, follow: false },
};

export default async function TenantDashboardPage() {
  const locale = await getActiveLocale();
  return <TenantDashboard locale={locale} />;
}
