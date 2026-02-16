import { getActiveLocale } from "@/lib/i18n/server";

import { TenantMessages } from "./tenant-messages";

export const metadata = {
  title: "Messages | Tenant Portal | Stoa",
  robots: { index: false, follow: false },
};

export default async function TenantMessagesPage() {
  const locale = await getActiveLocale();
  return <TenantMessages locale={locale} />;
}
