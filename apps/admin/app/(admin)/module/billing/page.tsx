import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { BillingManager } from "./billing-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function BillingPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Missing organization" : "Falta organización"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Select an organization to manage billing."
              : "Selecciona una organización para gestionar facturación."}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  let billingData: Record<string, unknown> = {};
  let plans: Record<string, unknown>[] = [];
  try {
    billingData = (await fetchJson<Record<string, unknown>>(
      `/billing/current?org_id=${orgId}`
    )) ?? {};
    const plansRes = await fetchJson<{ data: Record<string, unknown>[] }>(
      `/subscription-plans`
    );
    plans = plansRes?.data ?? [];
  } catch (err) {
    if (isOrgMembershipError(errorMessage(err))) return <OrgAccessChanged orgId={orgId} />;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Billing" : "Facturación"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              {isEn
                ? "Failed to load billing info."
                : "Error al cargar información de facturación."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEn ? "Billing & Subscription" : "Facturación y Suscripción"}</CardTitle>
        <CardDescription>
          {isEn
            ? "Manage your subscription plan and usage."
            : "Gestiona tu plan de suscripción y uso."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success.replaceAll("-", " ")}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert className="mb-4" variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <BillingManager
          billingData={billingData}
          locale={locale}
          orgId={orgId}
          plans={plans}
        />
      </CardContent>
    </Card>
  );
}
