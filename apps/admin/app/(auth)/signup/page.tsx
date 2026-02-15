"use client";

import {
  ArrowRight01Icon,
  LockPasswordIcon,
  Mail01Icon,
  UserCircle02Icon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getSiteUrl } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

export default function SignupPage() {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/app";

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [referralCode, setReferralCode] = useState(
    searchParams.get("ref") ?? ""
  );
  const [busy, setBusy] = useState(false);

  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        router.replace(next);
      }
    });
    return () => {
      mounted = false;
    };
  }, [next, router, supabase]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      toast.error(
        isEn ? "Supabase is not configured" : "Supabase no está configurado",
        {
          description: isEn
            ? "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/admin/.env.local."
            : "Configura NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY en apps/admin/.env.local.",
        }
      );
      return;
    }

    const trimmedEmail = email.trim();
    if (!(trimmedEmail && password)) {
      toast.error(isEn ? "Missing information" : "Faltan datos", {
        description: isEn
          ? "Email and password are required."
          : "El correo y la contraseña son obligatorios.",
      });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          data: fullName.trim() ? { full_name: fullName.trim() } : undefined,
          emailRedirectTo: `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });

      if (error) {
        toast.error(
          isEn ? "Could not create account" : "No se pudo crear la cuenta",
          {
            description: error.message,
          }
        );
        return;
      }

      // Persist referral code for redemption after onboarding
      const trimmedRef = referralCode.trim().toUpperCase();
      if (trimmedRef) {
        try {
          localStorage.setItem("pa-referral-code", trimmedRef);
        } catch {
          /* ignore */
        }
      }

      toast.success(isEn ? "Account created" : "Cuenta creada", {
        description: isEn
          ? "Check your email to confirm your address."
          : "Revisa tu correo para confirmar tu dirección.",
      });
      router.replace(`/login?next=${encodeURIComponent(next)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <CardTitle className="text-2xl">
          {isEn ? "Create account" : "Crear cuenta"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Start managing your portfolio from a single place."
            : "Empieza a administrar tu portafolio desde un solo lugar."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">
              {isEn ? "Full name" : "Nombre completo"}
            </span>
            <div className="relative">
              <Icon
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                icon={UserCircle02Icon}
                size={16}
              />
              <Input
                autoComplete="name"
                className="pl-9"
                onChange={(event) => setFullName(event.target.value)}
                placeholder={isEn ? "Your name" : "Tu nombre"}
                value={fullName}
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">
              {isEn ? "Email" : "Correo"}
            </span>
            <div className="relative">
              <Icon
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                icon={Mail01Icon}
                size={16}
              />
              <Input
                autoComplete="email"
                className="pl-9"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                type="email"
                value={email}
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">
              {isEn ? "Password" : "Contraseña"}
            </span>
            <div className="relative">
              <Icon
                className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
                icon={LockPasswordIcon}
                size={16}
              />
              <Input
                autoComplete="new-password"
                className="pl-9"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isEn ? "Create a password" : "Crea una contraseña"}
                type="password"
                value={password}
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">
              {isEn ? "Referral code (optional)" : "Código de referido (opcional)"}
            </span>
            <Input
              className="font-mono uppercase"
              onChange={(event) => setReferralCode(event.target.value)}
              placeholder="PA-XXXXXXXX"
              value={referralCode}
            />
          </label>

          <Button className="group w-full gap-2" disabled={busy} type="submit">
            <span
              className={cn(
                "transition-opacity",
                busy ? "opacity-60" : "opacity-100"
              )}
            >
              {isEn ? "Create account" : "Crear cuenta"}
            </span>
            <Icon
              className={cn(
                "transition-transform",
                busy ? "translate-x-0" : "group-hover:translate-x-0.5"
              )}
              icon={ArrowRight01Icon}
              size={18}
            />
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            {isEn ? "Already have an account?" : "¿Ya tienes una cuenta?"}
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/forgot-password"
          >
            {isEn ? "Forgot your password?" : "¿Olvidaste tu contraseña?"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
