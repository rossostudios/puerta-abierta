import { ChatThread } from "@/components/agent/chat-thread";
import { getActiveLocale } from "@/lib/i18n/server";
import { NoOrgCard } from "@/lib/page-helpers";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  params: Promise<{ chatId: string }>;
};

export default async function ChatDetailPage({ params }: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";
  const { chatId } = await params;

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["the chat thread", "el hilo de chat"]}
      />
    );
  }

  return <ChatThread chatId={chatId} locale={locale} orgId={orgId} />;
}
