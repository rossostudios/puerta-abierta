import { getActiveLocale } from "@/lib/i18n/server";

import { TenantDocuments } from "./tenant-documents";

export const metadata = {
  title: "Documents | Tenant Portal | Stoa",
  robots: { index: false, follow: false },
};

export default async function TenantDocumentsPage() {
  const locale = await getActiveLocale();
  return <TenantDocuments locale={locale} />;
}
