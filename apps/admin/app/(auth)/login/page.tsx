"use client";

import {
  AppleIcon,
  Building01Icon,
  GoogleIcon,
  LockPasswordIcon,
  Mail01Icon,
  ViewIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { useActiveLocale } from "@/lib/i18n/client";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";

  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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

  const handleOAuth = async (provider: "google" | "apple") => {
    if (!supabase) {
      toast.error(
        isEn ? "Supabase is not configured" : "Supabase no está configurado"
      );
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      toast.error(
        isEn ? "Could not sign in" : "No se pudo iniciar sesión",
        { description: error.message }
      );
    }
  };

  return (
    <div className="flex flex-col items-center">
      {/* Logo */}
      <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
        <Icon icon={Building01Icon} size={24} />
      </div>

      {/* Heading */}
      <h1 className="text-2xl font-semibold tracking-tight">
        {isEn ? "Welcome back!" : "¡Bienvenido de nuevo!"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {isEn
          ? "Enter email & password to continue."
          : "Ingresa tu correo y contraseña para continuar."}
      </p>

      {/* Form */}
      <form className="mt-8 w-full space-y-4" onSubmit={onSubmit}>
        {/* Email */}
        <div className="relative">
          <Icon
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            icon={Mail01Icon}
            size={18}
          />
          <Input
            autoComplete="email"
            className="h-12 rounded-full pl-10 text-sm"
            onChange={(e) => setEmail(e.target.value)}
            placeholder={
              isEn
                ? "Enter your email address"
                : "Ingresa tu correo electrónico"
            }
            type="email"
            value={email}
          />
        </div>

        {/* Password */}
        <div className="relative">
          <Icon
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted-foreground"
            icon={LockPasswordIcon}
            size={18}
          />
          <Input
            autoComplete="current-password"
            className="h-12 rounded-full pl-10 pr-11 text-sm"
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              isEn ? "Enter your password" : "Ingresa tu contraseña"
            }
            type={showPassword ? "text" : "password"}
            value={password}
          />
          <button
            className="absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword((v) => !v)}
            tabIndex={-1}
            type="button"
          >
            <Icon icon={showPassword ? ViewOffIcon : ViewIcon} size={18} />
          </button>
        </div>

        {/* Remember me + Forgot password */}
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm select-none">
            <Checkbox />
            <span className="text-muted-foreground">
              {isEn ? "Remember me" : "Recordarme"}
            </span>
          </label>
          <Link
            className="text-sm font-semibold transition-colors hover:text-primary"
            href="/forgot-password"
          >
            {isEn ? "Forgot password" : "Olvidé mi contraseña"}
          </Link>
        </div>

        {/* Sign In button */}
        <Button
          className="h-12 w-full rounded-full bg-foreground text-background shadow-none hover:bg-foreground/90"
          disabled={busy}
          type="submit"
        >
          {busy
            ? isEn
              ? "Signing in..."
              : "Iniciando sesión..."
            : isEn
              ? "Sign In"
              : "Iniciar sesión"}
        </Button>
      </form>

      {/* Divider */}
      <div className="my-6 flex w-full items-center gap-4">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">
          {isEn ? "Or sign in with" : "O inicia sesión con"}
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>

      {/* Social buttons */}
      <div className="grid w-full grid-cols-2 gap-3">
        <Button
          className="h-12 gap-2 rounded-full"
          onClick={() => handleOAuth("google")}
          type="button"
          variant="outline"
        >
          <Icon icon={GoogleIcon} size={18} />
          Google
        </Button>
        <Button
          className="h-12 gap-2 rounded-full"
          onClick={() => handleOAuth("apple")}
          type="button"
          variant="outline"
        >
          <Icon icon={AppleIcon} size={18} />
          Apple
        </Button>
      </div>

      {/* Create account */}
      <p className="mt-8 text-sm text-muted-foreground">
        {isEn ? "Don't have an account? " : "¿No tienes una cuenta? "}
        <Link
          className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          href="/signup"
        >
          {isEn ? "Create an account" : "Crear una cuenta"}
        </Link>
      </p>
    </div>
  );
}
