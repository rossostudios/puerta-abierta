import { currentUser } from "@clerk/nextjs/server";
import { ChatsWorkspace } from "@/components/agent/chats-workspace";
import { getActiveLocale } from "@/lib/i18n/server";
import { NoOrgCard } from "@/lib/page-helpers";
import { getActiveOrgId } from "@/lib/org";

export default async function ChatsPage() {
  const [locale, orgId, user] = await Promise.all([
    getActiveLocale(),
    getActiveOrgId(),
    currentUser(),
  ]);
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <NoOrgCard isEn={isEn} resource={["chat history", "historial de chats"]} />
    );
  }

  return (
    <ChatsWorkspace
      firstName={user?.firstName ?? undefined}
      locale={locale}
      orgId={orgId}
    />
  );
}
