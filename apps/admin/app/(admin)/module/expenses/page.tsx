import Link from "next/link";

import { OrgAccessChanged } from "@/components/shell/org-access-changed";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

import { ExpensesManager } from "./expenses-manager";

type PageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function ExpensesModulePage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const orgId = await getActiveOrgId();
  const { success, error } = await searchParams;
  const successLabel = success ? safeDecode(success).replaceAll("-", " ") : "";
  const errorLabel = error ? safeDecode(error) : "";

  if (!orgId) {
    return <NoOrgCard isEn={isEn} resource={["expenses", "gastos"]} />;
  }

  let expenses: Record<string, unknown>[] = [];
  let properties: Record<string, unknown>[] = [];
  let units: Record<string, unknown>[] = [];

  try {
    const [expenseRows, propertyRows, unitRows] = await Promise.all([
      fetchList("/expenses", orgId, 2000),
      fetchList("/properties", orgId, 500),
      fetchList("/units", orgId, 500),
    ]);
    expenses = expenseRows as Record<string, unknown>[];
    properties = propertyRows as Record<string, unknown>[];
    units = unitRows as Record<string, unknown>[];
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
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{isEn ? "Finance" : "Finanzas"}</Badge>
                <Badge className="text-[11px]" variant="secondary">
                  {isEn ? "Expenses" : "Gastos"}
                </Badge>
              </div>
              <CardTitle className="text-2xl">
                {isEn ? "Expenses" : "Gastos"}
              </CardTitle>
              <CardDescription>
                {isEn
                  ? "Track operational spending by property, unit, or reservation."
                  : "Seguimiento de gastos por propiedad, unidad o reserva."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
                href="/module/owner-statements"
              >
                {isEn ? "Payout statements" : "Liquidaciones"}
              </Link>
              <Link
                className={cn(
                  buttonVariants({ variant: "secondary", size: "sm" })
                )}
                href="/module/reports"
              >
                {isEn ? "Reports" : "Reportes"}
              </Link>
            </div>
          </div>
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

          <ExpensesManager
            expenses={expenses}
            orgId={orgId}
            properties={properties}
            units={units}
          />
        </CardContent>
      </Card>
    </div>
  );
}
