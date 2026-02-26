"use client";

import { Ticket01Icon } from "@hugeicons/core-free-icons";
import { SignUp, useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { getAdminUrl } from "@/lib/app-urls";

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupPageInner />
    </Suspense>
  );
}

function SignupPageInner() {
  const searchParams = useSearchParams();
  const adminUrl = getAdminUrl();
  const referralCode = (searchParams.get("ref") ?? "").trim().toUpperCase();
  const { isLoaded, userId } = useAuth();

  useEffect(() => {
    if (referralCode) {
      localStorage.setItem("pa-referral-code", referralCode);
    }
  }, [referralCode]);

  useEffect(() => {
    if (isLoaded && userId) {
      window.location.assign(`${adminUrl}/app`);
    }
  }, [adminUrl, isLoaded, userId]);

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2,#3b82f6)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg border bg-card/70 shadow-sm">
            <Icon icon={Ticket01Icon} size={18} />
          </span>
          <CardTitle className="text-2xl">Create account</CardTitle>
        </div>
        <CardDescription>Create your Casaora account with Clerk.</CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {referralCode ? (
          <div className="rounded-lg border bg-card/70 px-3 py-2 text-sm">
            <p className="font-medium">Referral code saved</p>
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
            fallbackRedirectUrl={`${adminUrl}/app`}
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
            Already have an account?
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/login"
          >
            Sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
