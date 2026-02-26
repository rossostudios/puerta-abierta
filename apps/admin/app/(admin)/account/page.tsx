import { UserProfile } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { getActiveLocale } from "@/lib/i18n/server";

type AccountPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const params = await searchParams;
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const user = await currentUser();

  if (!user) {
    redirect("/login");
  }

  const errorMessage = typeof params.error === "string" ? params.error : "";
  const successCode = typeof params.success === "string" ? params.success : "";

  return (
    <div className="space-y-6">
      {errorMessage ? (
        <Alert variant="destructive">
          <AlertTitle>
            {isEn ? "Update failed" : "Falló la actualización"}
          </AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}

      {successCode ? (
        <Alert variant="success">
          <AlertTitle>{isEn ? "Updated" : "Actualizado"}</AlertTitle>
          <AlertDescription>
            {isEn
              ? "The requested account change was applied."
              : "Se aplicó el cambio solicitado en la cuenta."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Account" : "Cuenta"}</Badge>
            <Badge className="text-[11px]" variant="secondary">
              Clerk Auth
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {user.primaryEmailAddress?.emailAddress ??
              (isEn ? "Signed in" : "Sesión iniciada")}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Your identity, password, MFA, and sessions are managed by Clerk."
              : "Tu identidad, contraseña, MFA y sesiones se gestionan con Clerk."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "Clerk user ID" : "ID de usuario Clerk"}
              </p>
              <p className="truncate font-mono text-xs" title={user.id}>
                {user.id}
              </p>
            </div>
            <CopyButton className="h-8" value={user.id} />
          </div>
          <SignOutButton variant="outline" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Manage account" : "Gestionar cuenta"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Update profile details, password, and security settings."
              : "Actualiza perfil, contraseña y configuración de seguridad."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-hidden rounded-xl border bg-card/70 p-2">
            <UserProfile
              appearance={{
                elements: {
                  card: "shadow-none border-0 bg-transparent",
                  rootBox: "w-full",
                },
              }}
              routing="hash"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
