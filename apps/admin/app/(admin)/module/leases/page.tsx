import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { LeasesManager } from "./leases-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function LeasesModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["leases", "contratos"]} />;
  }

  let leases: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    [leases, properties, units] = (await Promise.all([
      fetchList("/leases", orgId, 300),
      fetchList("/properties", orgId, 300),
      fetchList("/units", orgId, 300),
    ])) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) return <OrgAccessChanged orgId={orgId} />;
    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <LeasesManager
      error={error ? safeDecode(error) : undefined}
      leases={leases}
      orgId={orgId}
      properties={properties}
      success={success ? safeDecode(success).replaceAll("-", " ") : undefined}
      units={units}
    />
  );
}
