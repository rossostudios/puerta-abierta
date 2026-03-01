import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";
import { ReservationsManager } from "./reservations-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ReservationsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["reservations", "reservas"]} />;
  }

  let reservations: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    [reservations, units] = (await Promise.all([
      fetchList("/reservations", orgId, 1000),
      fetchList("/units", orgId, 500),
    ])) as [Record<string, unknown>[], Record<string, unknown>[]];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) return <OrgAccessChanged orgId={orgId} />;
    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <ReservationsManager
      error={error ? safeDecode(error) : undefined}
      orgId={orgId}
      reservations={reservations}
      success={success ? safeDecode(success).replaceAll("-", " ") : undefined}
      units={units}
    />
  );
}
