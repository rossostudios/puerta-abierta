import { getActiveLocale } from "@/lib/i18n/server";
import { ChannelsManager } from "./channels-manager";

export default async function ChannelsPage() {
  const locale = await getActiveLocale();
  return <ChannelsManager locale={locale} />;
}
