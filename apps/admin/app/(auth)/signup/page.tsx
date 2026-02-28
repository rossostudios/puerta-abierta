"use client";

import { SignUp, useAuth } from "@clerk/nextjs";
import { ArrowRight01Icon, Ticket01Icon } from "@hugeicons/core-free-icons";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";

function safeNextPath(value: string | null): string {
  if (!value?.startsWith("/")) return "/app";
  return value;
}

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const locale = useActiveLocale();
  const isEn = locale === "en-US";
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const referralCode = (searchParams.get("ref") ?? "").trim().toUpperCase();
  const { userId, isLoaded } = useAuth();

  useEffect(() => {
    if (referralCode) {
      localStorage.setItem("pa-referral-code", referralCode);
    }
  }, [referralCode]);

  useEffect(() => {
    if (isLoaded && userId) {
      router.replace(next);
      router.refresh();
    }
  }, [isLoaded, userId, next, router]);

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card/70 shadow-sm">
            <Icon icon={Ticket01Icon} size={18} />
          </span>
          <CardTitle className="text-2xl">
            {isEn ? "Create account" : "Crear cuenta"}
          </CardTitle>
        </div>
        <CardDescription>
          {isEn
            ? "Create your Casaora account with Clerk."
            : "Crea tu cuenta de Casaora con Clerk."}
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {referralCode ? (
          <div className="rounded-lg border bg-card/70 px-3 py-2 text-sm">
            <p className="font-medium">
              {isEn ? "Referral code saved" : "Código de referido guardado"}
            </p>
            <p className="mt-1 font-mono text-muted-foreground text-xs">
              {referralCode}
            </p>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-2xl border bg-card/70 p-2">
          <SignUp
            appearance={{
              elements: {
                card: "shadow-none border-0 bg-transparent",
                rootBox: "w-full",
              },
            }}
            fallbackRedirectUrl={next}
            path="/signup"
            routing="path"
            signInUrl="/login"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href="/login"
          >
            {isEn ? "Already have an account?" : "¿Ya tienes una cuenta?"}
          </Link>
          <Link
            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/login"
          >
            {isEn ? "Sign in" : "Iniciar sesión"}
            <Icon icon={ArrowRight01Icon} size={14} />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
