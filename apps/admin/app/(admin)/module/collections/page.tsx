import { Suspense } from "react";
import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchList } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { safeDecode } from "@/lib/module-helpers";
import { getActiveOrgId } from "@/lib/org";
import { ApiErrorCard, NoOrgCard } from "@/lib/page-helpers";

import { CollectionsManager } from "./collections-manager";
import { ReconciliationDashboard } from "./reconciliation";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function CollectionsModulePage({
  searchParams,
}: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;

  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["collections", "cobros"]} />;
  }

  let collections: Record<string, unknown>[] = [];
  let leases: Record<string, unknown>[] = [];
  let bankTransactions: Record<string, unknown>[] = [];
  let reconciliationRuns: Record<string, unknown>[] = [];
  try {
    const [collectionRows, leaseRows, txnRows, runRows] = await Promise.all([
      fetchList("/collections", orgId, 700),
      fetchList("/leases", orgId, 500),
      fetchList("/bank-transactions", orgId, 500).catch(
        () => [] as Record<string, unknown>[]
      ),
      fetchList("/reconciliation-runs", orgId, 50).catch(
        () => [] as Record<string, unknown>[]
      ),
    ]);
    collections = collectionRows as Record<string, unknown>[];
    leases = leaseRows as Record<string, unknown>[];
    bankTransactions = txnRows as Record<string, unknown>[];
    reconciliationRuns = runRows as Record<string, unknown>[];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return <OrgAccessChanged orgId={orgId} />;
    }

    return <ApiErrorCard isEn={isEn} message={message} />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Collections" : "Cobros"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Track payment schedules and mark successful collections."
              : "Monitorea cronogramas de pago y marca cobros exitosos."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorLabel ? (
            <Alert variant="destructive">
              <AlertTitle>
                {isEn
                  ? "Could not complete request"
                  : "No se pudo completar la solicitud"}
              </AlertTitle>
              <AlertDescription>{errorLabel}</AlertDescription>
            </Alert>
          ) : null}
          {successLabel ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "Success" : "Éxito"}: {successLabel}
              </AlertTitle>
            </Alert>
          ) : null}

          <Suspense fallback={null}>
            <CollectionsManager
              collections={collections}
              leases={leases}
              orgId={orgId}
            />
          </Suspense>
        </CardContent>
      </Card>
      {/* Bank Reconciliation Dashboard */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Sprint 6</Badge>
            <Badge className="text-[11px]" variant="secondary">
              {isEn ? "Reconciliation" : "Conciliación"}
            </Badge>
          </div>
          <CardTitle>
            {isEn ? "Bank Reconciliation" : "Conciliación Bancaria"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "ML-powered bank transaction matching. Import transactions and auto-match against collections."
              : "Conciliación inteligente de transacciones bancarias con colecciones."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <ReconciliationDashboard
              runs={reconciliationRuns}
              transactions={bankTransactions}
            />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
