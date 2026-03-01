import { currentUser } from "@clerk/nextjs/server";
import { ChatThread } from "@/components/agent/chat-thread";
import { fetchJson } from "@/lib/api";
import { NoOrgCard } from "@/lib/page-helpers";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

type PageProps = {
  searchParams: Promise<{ new?: string; agent?: string; prompt?: string }>;
};

export default async function AgentsPage({ searchParams }: PageProps) {
  const [locale, orgId, user] = await Promise.all([
    getActiveLocale(),
    getActiveOrgId(),
    currentUser(),
  ]);
  const isEn = locale === "en-US";
  const params = await searchParams;

  if (!orgId) {
    return (
      <NoOrgCard isEn={isEn} resource={["agents", "agentes"]} />
    );
  }

  const initialAgentSlug =
    typeof params.agent === "string" && params.agent.trim()
      ? params.agent.trim()
      : "supervisor";

  let dashboardStats: Record<string, unknown> = {};
  try {
    dashboardStats = await fetchJson<Record<string, unknown>>(
      "/ai-agents/dashboard/stats",
      { org_id: orgId }
    );
  } catch {
    // Stats are non-critical — CommandCenter gracefully handles empty data
  }

  return (
    <div className="-m-3 h-[calc(100vh-3.5rem)] sm:-m-4 lg:-m-5 xl:-m-7">
      <ChatThread
        dashboardStats={dashboardStats}
        defaultAgentSlug={initialAgentSlug}
        firstName={user?.firstName ?? undefined}
        freshKey={typeof params.new === "string" ? params.new : undefined}
        initialPrompt={
          typeof params.prompt === "string" && params.prompt.trim()
            ? params.prompt.trim()
            : undefined
        }
        locale={locale}
        mode="hero"
        orgId={orgId}
      />
    </div>
  );
}
