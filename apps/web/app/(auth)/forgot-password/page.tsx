"use client";

import Link from "next/link";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function ForgotPasswordPage() {
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2,#3b82f6)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>
          Password reset is now handled directly in the Clerk sign-in flow.
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        <p className="text-muted-foreground text-sm">
          Open the sign-in page and use Clerk&apos;s <span className="font-medium text-foreground">Forgot password?</span> option.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <Link className="text-primary underline-offset-4 hover:underline" href="/login">
            Back to sign in
          </Link>
          <Link
            className="inline-flex h-8 items-center justify-center rounded-lg border border-input bg-background px-3 text-xs shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            href="/login"
          >
            Go to sign in
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
