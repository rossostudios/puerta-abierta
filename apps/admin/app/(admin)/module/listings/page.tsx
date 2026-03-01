import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { ListingsManager } from "./listings-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ListingsModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["listings", "listados"]} />;
  }

  let listings: Record<string, unknown>[] = [];
  try {
    listings = (await fetchList("/listings", orgId, 500)) as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) return <OrgAccessChanged orgId={orgId} />;
    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <ListingsManager
      error={error ? safeDecode(error) : undefined}
      listings={listings}
      orgId={orgId}
      success={success ? safeDecode(success).replaceAll("-", " ") : undefined}
    />
  );
}
