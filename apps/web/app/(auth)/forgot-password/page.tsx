"use client";

import {
  ArrowRight01Icon,
  Mail01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";
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
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAdminUrl } from "@/lib/supabase/config";
import { cn } from "@/lib/utils";

export default function ForgotPasswordPage() {
  const adminUrl = getAdminUrl();

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const supabase = useMemo(() => {
    try {
      return getSupabaseBrowserClient();
    } catch {
      return null;
    }
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supabase) {
      toast.error("Supabase is not configured", {
        description:
          "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in apps/web/.env.local.",
      });
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      toast.error("Email required", {
        description: "Enter the email you used to create your account.",
      });
      return;
    }

    setBusy(true);
    const redirectTo = `${adminUrl}/auth/callback?next=${encodeURIComponent("/reset-password")}`;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(
        trimmedEmail,
        { redirectTo }
      );

      if (error) {
        toast.error("Could not send link", { description: error.message });
        setBusy(false);
        return;
      }

      toast.success("Check your email", {
        description: "We sent a password reset link (if the account exists).",
      });
      setEmail("");
      setBusy(false);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_0%_0%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent_45%),radial-gradient(circle_at_100%_10%,color-mix(in_oklch,var(--chart-2,#3b82f6)_12%,transparent),transparent_55%)]" />

      <CardHeader className="relative">
        <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg border bg-background/70 text-primary">
          <Icon icon={ShieldKeyIcon} size={18} />
        </div>
        <CardTitle className="text-2xl">Reset password</CardTitle>
        <CardDescription>
          We&apos;ll email you a secure link to create a new password.
        </CardDescription>
      </CardHeader>

      <CardContent className="relative space-y-4">
        <form className="space-y-3" onSubmit={onSubmit}>
          <label className="block" htmlFor="forgot-email">
            <span className="mb-1 block font-medium text-muted-foreground text-xs">
              Email
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
                id="forgot-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
                type="email"
                value={email}
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
              Send link
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
            Back to sign in
          </Link>
          <Link
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/signup"
          >
            Create account
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
