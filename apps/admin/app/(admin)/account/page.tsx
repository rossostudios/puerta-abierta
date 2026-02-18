import { redirect } from "next/navigation";

import { AccountAvatarField } from "@/app/(admin)/account/account-avatar-field";
import {
  updateAccountAvatarAction,
  updateAccountNameAction,
  updateAccountPasswordAction,
} from "@/app/(admin)/account/actions";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { LanguageSelector } from "@/components/preferences/language-selector";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { getActiveLocale } from "@/lib/i18n/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function metadataString(source: unknown, key: string): string {
  if (!source || typeof source !== "object") return "";
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

type AccountPageProps = {
  searchParams: Promise<{ success?: string; error?: string }>;
};

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const params = await searchParams;
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const currentName =
    metadataString(user.user_metadata, "full_name") ||
    metadataString(user.user_metadata, "name");
  const currentAvatarUrl = metadataString(user.user_metadata, "avatar_url");

  const successCode = typeof params.success === "string" ? params.success : "";
  const errorMessage = typeof params.error === "string" ? params.error : "";

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

      {successCode === "profile-updated" ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn ? "Profile updated" : "Perfil actualizado"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Your name was updated successfully."
              : "Tu nombre se actualizó correctamente."}
          </AlertDescription>
        </Alert>
      ) : null}

      {successCode === "avatar-updated" ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn ? "Avatar updated" : "Avatar actualizado"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Your avatar was updated successfully."
              : "Tu avatar se actualizó correctamente."}
          </AlertDescription>
        </Alert>
      ) : null}

      {successCode === "password-updated" ? (
        <Alert variant="success">
          <AlertTitle>
            {isEn ? "Password updated" : "Contraseña actualizada"}
          </AlertTitle>
          <AlertDescription>
            {isEn
              ? "Your password was changed successfully."
              : "Tu contraseña se cambió correctamente."}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Account" : "Cuenta"}</Badge>
            <Badge className="text-[11px]" variant="secondary">
              Supabase Auth
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {user.email ?? (isEn ? "Signed in" : "Sesión iniciada")}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage your session and basic identity info."
              : "Administra tu sesión e información básica de identidad."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium text-muted-foreground text-xs">
                {isEn ? "User ID" : "ID de usuario"}
              </p>
              <p className="truncate font-mono text-xs" title={user.id}>
                {user.id}
              </p>
            </div>
            <CopyButton className="h-8" value={user.id} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <SignOutButton variant="outline" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Profile" : "Perfil"}</Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Avatar" : "Avatar"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Choose a profile image shown in your account menu."
              : "Elige una imagen de perfil para el menú de cuenta."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAccountAvatarAction} className="space-y-4">
            <AccountAvatarField
              currentName={currentName || user.email || "User"}
              initialAvatarUrl={currentAvatarUrl}
              isEn={isEn}
              userId={user.id}
            />
            <Button type="submit">
              {isEn ? "Save avatar" : "Guardar avatar"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Profile" : "Perfil"}</Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Public name" : "Nombre público"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "This name is used across the admin and communications."
              : "Este nombre se usa en el admin y comunicaciones."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAccountNameAction} className="space-y-4">
            <label className="block space-y-2" htmlFor="full_name">
              <span className="font-medium text-sm">
                {isEn ? "Full name" : "Nombre completo"}
              </span>
              <Input
                autoComplete="name"
                defaultValue={currentName}
                id="full_name"
                name="full_name"
                placeholder={isEn ? "Your name" : "Tu nombre"}
                required
              />
            </label>
            <Button type="submit">
              {isEn ? "Save name" : "Guardar nombre"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{isEn ? "Security" : "Seguridad"}</Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Password" : "Contraseña"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Use a strong password with at least 8 characters."
              : "Usa una contraseña segura de al menos 8 caracteres."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={updateAccountPasswordAction} className="space-y-4">
            <label className="block space-y-2" htmlFor="password">
              <span className="font-medium text-sm">
                {isEn ? "New password" : "Nueva contraseña"}
              </span>
              <Input
                autoComplete="new-password"
                id="password"
                name="password"
                placeholder={
                  isEn ? "At least 8 characters" : "Mínimo 8 caracteres"
                }
                required
                type="password"
              />
            </label>

            <label className="block space-y-2" htmlFor="confirm_password">
              <span className="font-medium text-sm">
                {isEn ? "Confirm password" : "Confirmar contraseña"}
              </span>
              <Input
                autoComplete="new-password"
                id="confirm_password"
                name="confirm_password"
                placeholder={
                  isEn ? "Repeat your password" : "Repite tu contraseña"
                }
                required
                type="password"
              />
            </label>

            <Button type="submit">
              {isEn ? "Update password" : "Actualizar contraseña"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card id="preferencias">
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Preferences" : "Preferencias"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Preferences" : "Preferencias"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Personal settings for your account (language, formats, and more)."
              : "Ajustes personales de tu cuenta (idioma, formato y más)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <p className="font-medium text-sm">
                {isEn ? "Language" : "Idioma"}
              </p>
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "Spanish is the default. More languages soon."
                  : "Español es el predeterminado. Más idiomas pronto."}
              </p>
            </div>
            <div className="w-full md:w-64">
              <LanguageSelector />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
