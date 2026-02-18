import {
  ArrowRight01Icon,
  CheckmarkCircle01Icon,
  Mail01Icon,
  Ticket01Icon,
} from "@hugeicons/core-free-icons";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { redirect, unstable_rethrow } from "next/navigation";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { postJson } from "@/lib/api";
import { shouldUseSecureCookie } from "@/lib/cookies";
import { getActiveLocale } from "@/lib/i18n/server";
import { ORG_COOKIE_NAME } from "@/lib/org";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

type InvitePageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function inviteUrl(
  token: string,
  params?: { error?: string; success?: string }
) {
  const qs = new URLSearchParams();
  if (params?.error) qs.set("error", params.error);
  if (params?.success) qs.set("success", params.success);
  const suffix = qs.toString();
  return suffix
    ? `/invite/${encodeURIComponent(token)}?${suffix}`
    : `/invite/${encodeURIComponent(token)}`;
}

function shortToken(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}

export default async function InviteAcceptPage({
  params,
  searchParams,
}: InvitePageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";

  const { token } = await params;
  const sp = (await searchParams) ?? {};
  const error = typeof sp.error === "string" ? sp.error : null;
  const success = typeof sp.success === "string" ? sp.success : null;

  let userEmail: string | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    userEmail = data.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  async function acceptInviteAction() {
    "use server";

    const inviteToken = token.trim();
    if (!inviteToken) {
      redirect(
        inviteUrl(token, {
          error: isEn
            ? "Invalid invitation token."
            : "Token de invitación inválido.",
        })
      );
    }

    let redirectPath: string;
    try {
      const response = (await postJson("/organization-invites/accept", {
        token: inviteToken,
      })) as { organization_id?: string } | null;

      const organizationId =
        typeof response?.organization_id === "string"
          ? response.organization_id.trim()
          : "";

      if (organizationId) {
        const hdrs = await headers();
        const store = await cookies();
        store.set(ORG_COOKIE_NAME, organizationId, {
          path: "/",
          sameSite: "lax",
          httpOnly: false,
          secure: shouldUseSecureCookie(hdrs),
          maxAge: 60 * 60 * 24 * 365,
        });
      }

      redirectPath = "/setup?success=invite-accepted";
    } catch (err) {
      unstable_rethrow(err);
      const message = err instanceof Error ? err.message : String(err);
      redirectPath = inviteUrl(token, { error: message.slice(0, 240) });
    }
    redirect(redirectPath);
  }

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_14%,transparent),transparent_55%)]" />

      <CardHeader className="relative space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card/70 shadow-sm">
              <Icon icon={Ticket01Icon} size={18} />
            </span>
            <CardTitle className="text-2xl">
              {isEn ? "Accept invitation" : "Aceptar invitación"}
            </CardTitle>
          </div>
          <span className="rounded-md border bg-muted/30 px-2 py-1 font-mono text-muted-foreground text-xs">
            {shortToken(token)}
          </span>
        </div>
        <CardDescription>
          {isEn
            ? "Join an organization to start managing properties, units, and reservations."
            : "Únete a una organización para empezar a gestionar propiedades, unidades y reservas."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">
              {isEn ? "Could not accept" : "No se pudo aceptar"}
            </p>
            <p className="mt-1 break-words text-muted-foreground">{error}</p>
          </div>
        ) : null}

        {success ? (
          <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Icon icon={CheckmarkCircle01Icon} size={18} />
              {isEn ? "Invitation accepted" : "Invitación aceptada"}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border bg-card p-4">
          <p className="font-medium text-sm">
            {isEn ? "Current account" : "Cuenta actual"}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <Icon icon={Mail01Icon} size={16} />
              <span className="truncate">
                {userEmail ?? (isEn ? "Signed-in user" : "Usuario autenticado")}
              </span>
            </div>
            <SignOutButton size="sm" variant="outline">
              {isEn ? "Switch account" : "Cambiar cuenta"}
            </SignOutButton>
          </div>
          <p className="mt-2 text-muted-foreground text-xs">
            {isEn
              ? "If this invite was sent to a different email, sign out and sign in with that email to accept it."
              : "Si esta invitación fue enviada a otro correo, cierra sesión y entra con ese correo para aceptarla."}
          </p>
        </div>

        <form action={acceptInviteAction}>
          <Button className="group w-full gap-2" type="submit">
            <span className="transition-opacity">
              {isEn ? "Accept and continue" : "Aceptar y continuar"}
            </span>
            <Icon
              className={cn("transition-transform group-hover:translate-x-0.5")}
              icon={ArrowRight01Icon}
              size={18}
            />
          </Button>
        </form>

        <div className="flex items-center justify-center">
          <Link
            className="text-muted-foreground text-sm underline-offset-4 hover:text-foreground hover:underline"
            href="/setup"
          >
            {isEn ? "Go to onboarding" : "Ir a onboarding"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
