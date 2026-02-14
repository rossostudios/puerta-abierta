import { MarketplacePageSkeleton } from "./components/marketplace-skeleton";

export default function MarketplaceLoading() {
  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <div className="sticky top-0 z-40 border-border/70 border-b bg-background/92 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1560px] items-center justify-between px-3 py-3 sm:px-6 lg:px-8">
          <div className="h-11 w-36 animate-pulse rounded-2xl bg-muted/50" />
          <div className="flex gap-2">
            <div className="h-10 w-10 animate-pulse rounded-xl bg-muted/40" />
            <div className="h-10 w-10 animate-pulse rounded-xl bg-muted/40" />
            <div className="hidden h-10 w-28 animate-pulse rounded-xl bg-muted/40 sm:block" />
          </div>
        </div>
      </div>

      <main className="mx-auto w-full max-w-[1560px] space-y-6 px-3 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
        <MarketplacePageSkeleton />
      </main>
    </div>
  );
}
