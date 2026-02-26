"use client";

import { Building01Icon } from "@hugeicons/core-free-icons";
import { SignIn, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { Icon } from "@/components/ui/icon";
import { useActiveLocale } from "@/lib/i18n/client";

function safeNextPath(value: string | null): string {
  if (!(value && value.startsWith("/"))) return "/app";
  return value;
}

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
  const next = safeNextPath(searchParams.get("next"));
  const { userId, isLoaded } = useAuth();

  useEffect(() => {
    if (isLoaded && userId) {
      router.replace(next);
      router.refresh();
    }
  }, [isLoaded, userId, next, router]);

  return (
    <div className="flex w-full flex-col items-center">
      <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
        <Icon icon={Building01Icon} size={24} />
      </div>

      <h1 className="font-semibold text-2xl tracking-tight">
        {isEn ? "Welcome back!" : "¡Bienvenido de nuevo!"}
      </h1>
      <p className="mt-2 text-center text-muted-foreground text-sm">
        {isEn
          ? "Sign in securely with Clerk."
          : "Inicia sesión de forma segura con Clerk."}
      </p>

      <div className="mt-8 w-full overflow-hidden rounded-2xl border bg-card/70 p-2 shadow-sm">
        <SignIn
          appearance={{
            elements: {
              card: "shadow-none border-0 bg-transparent",
              rootBox: "w-full",
            },
          }}
          fallbackRedirectUrl={next}
          path="/login"
          routing="path"
          signUpUrl="/signup"
        />
      </div>

      <p className="mt-6 text-center text-muted-foreground text-sm">
        {isEn ? "Need an invite?" : "¿Necesitas una invitación?"}{" "}
        <Link
          className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
          href="/signup"
        >
          {isEn ? "Create an account" : "Crear una cuenta"}
        </Link>
      </p>
    </div>
  );
}
