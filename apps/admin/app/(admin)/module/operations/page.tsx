import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList } from "@/lib/api";
import { getServerCurrentAppUserId } from "@/lib/auth/server-app-user";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { OperationsManager } from "./operations-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function OperationsHubPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["operations", "operaciones"]} />;
  }

  const sessionUserId = await getServerCurrentAppUserId();
  const successMessage = success
    ? safeDecode(success).replaceAll("-", " ")
    : undefined;
  const errorLabel = error ? safeDecode(error) : undefined;

  let tasks: Record<string, unknown>[] = [];
  let requests: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];
  let members: Record<string, unknown>[] = [];

  try {
    [tasks, requests, properties, units, members] = (await Promise.all([
      fetchList("/tasks", orgId, 1000),
      fetchList("/maintenance-requests", orgId, 500),
      fetchList("/properties", orgId, 500),
      fetchList("/units", orgId, 500),
      fetchList(`/organizations/${orgId}/members`, orgId, 300),
    ])) as [
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
      Record<string, unknown>[],
    ];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }
    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <OperationsManager
      currentUserId={sessionUserId}
      error={errorLabel}
      members={members}
      orgId={orgId}
      properties={properties}
      requests={requests}
      success={successMessage}
      tasks={tasks}
      units={units}
    />
  );
}
