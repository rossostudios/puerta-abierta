"use client";

import {
  ArrowRight01Icon,
  LockPasswordIcon,
  Mail01Icon,
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
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          ? "Enter your email and password to sign in."
          : "Ingresa tu correo y contraseña para iniciar sesión.",
      });
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });
      if (error) {
        toast.error(isEn ? "Could not sign in" : "No se pudo iniciar sesión", {
          description: error.message,
        });
        return;
      }
      toast.success(isEn ? "Welcome back" : "Bienvenido de nuevo");
      router.replace(next);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <CardTitle className="text-2xl">
          {isEn ? "Sign in" : "Iniciar sesión"}
        </CardTitle>
        <CardDescription>
          {isEn
            ? "Use your owner account to access the operations console."
            : "Usa tu cuenta de propietario para acceder a la consola operativa."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        <form className="space-y-3" onSubmit={onSubmit}>
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
                autoComplete="current-password"
                className="pl-9"
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isEn ? "Your password" : "Tu contraseña"}
                type="password"
                value={password}
              />
            </div>
          </label>

          <Button className="group w-full gap-2" disabled={busy} type="submit">
            <span
              className={cn(
                "transition-opacity",
                busy ? "opacity-60" : "opacity-100"
              )}
            >
              {isEn ? "Sign in" : "Iniciar sesión"}
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
            href="/forgot-password"
          >
            {isEn ? "Forgot your password?" : "¿Olvidaste tu contraseña?"}
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/signup"
          >
            {isEn ? "Create an account" : "Crear una cuenta"}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
