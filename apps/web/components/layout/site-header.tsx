"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CasaoraLogo } from "@/components/icons/casaora-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL ?? "http://localhost:3000";

function ProductNavItem({ isActive }: { isActive: boolean }) {
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Used for hover mechanics
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Used for hover mechanics
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
          isActive || isHovered
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        href="/features"
      >
        Product
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-300 ease-out",
            isHovered ? "rotate-180" : ""
          )}
        />
      </Link>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="absolute top-full left-0 mt-2 w-[700px] overflow-hidden rounded-2xl border border-border/50 bg-background/95 shadow-xl backdrop-blur-xl"
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex bg-card/50">
              <div className="flex flex-1 flex-col gap-1 border-r border-border/30 p-4">
                <div className="mb-2 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Intake
                </div>
                <Link
                  className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                  href="/features#channel-manager"
                >
                  <span className="font-semibold text-foreground text-sm">
                    Channel Manager
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug transition-colors group-hover:text-foreground/80">
                    Sync Airbnb, Booking & VRBO in real-time
                  </span>
                </Link>
                <div className="mt-4 mb-2 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Plan
                </div>
                <Link
                  className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                  href="/features#operations"
                >
                  <span className="font-semibold text-foreground text-sm">
                    Operations
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug transition-colors group-hover:text-foreground/80">
                    Automate cleanings and dispatch teams
                  </span>
                </Link>
              </div>

              <div className="flex flex-1 flex-col gap-1 p-4">
                <div className="mb-2 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Build
                </div>
                <Link
                  className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                  href="/features#unified-inbox"
                >
                  <span className="font-semibold text-foreground text-sm">
                    Unified Inbox
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug transition-colors group-hover:text-foreground/80">
                    All guest communications in one place
                  </span>
                </Link>
                <div className="mt-4 mb-2 px-3 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
                  Reviews
                </div>
                <Link
                  className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                  href="/features#finance"
                >
                  <span className="font-semibold text-foreground text-sm">
                    Finance & Reports
                  </span>
                  <span className="text-muted-foreground text-xs leading-snug transition-colors group-hover:text-foreground/80">
                    Transparent owner statements
                  </span>
                </Link>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/30 bg-muted/30 px-6 py-4 transition-colors hover:bg-muted/50">
              <span className="font-medium text-foreground text-sm">
                New: Advanced filters and share issues in private teams
              </span>
              <span className="font-medium text-indigo-500 text-sm hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300">
                Changelog
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MarketplaceNavItem({ isActive }: { isActive: boolean }) {
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setIsHovered(false), 150);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Used for hover mechanics
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: Used for hover mechanics
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        className={cn(
          "inline-flex items-center gap-1 rounded-lg px-3 py-2 font-medium text-sm transition-colors",
          isActive || isHovered
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
        href="/marketplace"
      >
        Marketplace
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-300 ease-out",
            isHovered ? "rotate-180" : ""
          )}
        />
      </Link>

      <AnimatePresence>
        {isHovered && (
          <motion.div
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="absolute top-full left-1/2 mt-2 w-[340px] -translate-x-1/2 overflow-hidden rounded-2xl border border-border/50 bg-background/95 p-2 shadow-xl backdrop-blur-xl"
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="flex flex-col gap-1">
              <Link
                className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                href="/marketplace"
              >
                <span className="font-semibold text-foreground text-sm">
                  All Rentals
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  Browse our full collection of premium long-term rentals
                </span>
              </Link>
              <Link
                className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                href="/marketplace?furnished=true"
              >
                <span className="font-semibold text-foreground text-sm">
                  Furnished Homes
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  Move-in ready spaces with modern furniture included
                </span>
              </Link>
              <Link
                className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                href="/marketplace?property_type=shared_room"
              >
                <span className="font-semibold text-foreground text-sm">
                  Shared Rooms
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  Affordable co-living and shared spaces for individuals
                </span>
              </Link>
              <div className="my-1 h-px bg-border/50" />
              <Link
                className="group flex flex-col gap-1 rounded-xl p-3 transition-all duration-200 hover:bg-muted/60"
                href="/agents"
              >
                <span className="font-semibold text-primary text-sm">
                  For Real Estate Agents
                </span>
                <span className="text-muted-foreground text-xs leading-snug">
                  Partner with Casaora to expose your properties to verified
                  renters
                </span>
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function checkAuth() {
      try {
        const { getSupabaseBrowserClient } = await import(
          "@/lib/supabase/browser"
        );
        const supabase = getSupabaseBrowserClient();
        const { data } = await supabase.auth.getSession();
        if (mounted) setIsAuthenticated(!!data.session);

        const { data: listener } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (mounted) setIsAuthenticated(!!session);
          }
        );
        return () => {
          mounted = false;
          listener.subscription.unsubscribe();
        };
      } catch {
        // Supabase not configured — stay unauthenticated
      }
    }

    checkAuth();
    return () => {
      mounted = false;
    };
  }, []);

  if (pathname.startsWith("/studio")) return null;

  return (
    <header className="sticky top-0 z-50 border-border/50 border-b bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link
            className="flex items-center gap-2 font-bold text-foreground text-xl tracking-tight transition-opacity hover:opacity-80"
            href="/"
          >
            <CasaoraLogo size={24} />
            CASAORA
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <ProductNavItem isActive={pathname.startsWith("/features")} />
            <Link
              className={cn(
                "rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                pathname === "/pricing"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/pricing"
            >
              Pricing
            </Link>

            <MarketplaceNavItem
              isActive={pathname.startsWith("/marketplace")}
            />

            <Link
              className={cn(
                "rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                pathname === "/about"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/about"
            >
              About
            </Link>
            <Link
              className={cn(
                "rounded-lg px-3 py-2 font-medium text-sm transition-colors",
                pathname === "/blog"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/blog"
            >
              Blog
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />

          {isAuthenticated ? (
            <a
              className="hidden h-9 items-center rounded-lg bg-foreground px-4 font-medium text-background text-sm transition-opacity hover:opacity-90 md:inline-flex"
              href={`${ADMIN_URL}/app`}
            >
              Dashboard &rarr;
            </a>
          ) : (
            <>
              <Link
                className="hidden px-4 py-2 font-medium text-sm transition-opacity hover:opacity-80 md:inline-flex"
                href="/login"
              >
                Log in
              </Link>
              <Link
                className="hidden h-9 items-center rounded-lg bg-foreground px-4 font-medium text-background text-sm transition-opacity hover:opacity-90 md:inline-flex"
                href="/signup"
              >
                Sign up
              </Link>
            </>
          )}

          <button
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            type="button"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
            <span className="sr-only">Menu</span>
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {mobileOpen ? (
        <div className="border-border/50 border-t bg-background px-4 pb-4 md:hidden">
          <nav className="flex flex-col gap-1 pt-2">
            <Link
              className={cn(
                "rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
                pathname === "/features"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/features"
              onClick={() => setMobileOpen(false)}
            >
              Product
            </Link>
            <Link
              className={cn(
                "rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
                pathname === "/pricing"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/pricing"
              onClick={() => setMobileOpen(false)}
            >
              Pricing
            </Link>
            <Link
              className={cn(
                "rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
                pathname.startsWith("/marketplace")
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/marketplace"
              onClick={() => setMobileOpen(false)}
            >
              Marketplace
            </Link>
            <Link
              className={cn(
                "rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
                pathname === "/about"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/about"
              onClick={() => setMobileOpen(false)}
            >
              About
            </Link>
            <Link
              className={cn(
                "rounded-lg px-3 py-2.5 font-medium text-sm transition-colors",
                pathname === "/blog"
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              href="/blog"
              onClick={() => setMobileOpen(false)}
            >
              Blog
            </Link>
          </nav>
          <div className="mt-3 flex flex-col gap-2 px-3">
            {isAuthenticated ? (
              <a
                className="flex h-10 w-full items-center justify-center rounded-lg bg-foreground font-medium text-background text-sm transition-opacity hover:opacity-90"
                href={`${ADMIN_URL}/app`}
                onClick={() => setMobileOpen(false)}
              >
                Dashboard &rarr;
              </a>
            ) : (
              <>
                <Link
                  className="flex h-10 w-full items-center justify-center rounded-lg border border-border font-medium text-foreground text-sm transition-colors hover:bg-muted"
                  href="/login"
                  onClick={() => setMobileOpen(false)}
                >
                  Log in
                </Link>
                <Link
                  className="flex h-10 w-full items-center justify-center rounded-lg bg-foreground font-medium text-background text-sm transition-opacity hover:opacity-90"
                  href="/signup"
                  onClick={() => setMobileOpen(false)}
                >
                  Sign up
                </Link>
              </>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}
