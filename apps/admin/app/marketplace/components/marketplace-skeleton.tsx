const PILL_WIDTHS = [70, 90, 110, 70, 90, 110];
const SKELETON_KEYS = ["s0", "s1", "s2", "s3", "s4", "s5"];

export function MarketplaceHeroSkeleton() {
  return (
    <div
      className="animate-pulse rounded-3xl border border-border/60 px-5 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16"
      style={{ background: "var(--marketplace-hero-gradient)" }}
    >
      <div className="mx-auto max-w-3xl space-y-4 text-center">
        <div className="mx-auto h-10 w-3/4 rounded-xl bg-muted/60" />
        <div className="mx-auto h-5 w-1/2 rounded-lg bg-muted/40" />
        <div className="mx-auto mt-6 h-12 w-full max-w-2xl rounded-2xl bg-muted/50" />
      </div>
    </div>
  );
}

export function CategoryPillsSkeleton() {
  return (
    <div className="flex gap-2 overflow-hidden">
      {SKELETON_KEYS.map((key, i) => (
        <div
          className="h-9 shrink-0 animate-pulse rounded-full bg-muted/50"
          key={key}
          style={{ width: `${PILL_WIDTHS[i]}px` }}
        />
      ))}
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-card/95">
      <div className="aspect-[4/3] animate-pulse bg-muted/40" />
      <div className="space-y-2.5 p-3.5">
        <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted/60" />
        <div className="h-3 w-1/2 animate-pulse rounded bg-muted/40" />
        <div className="flex gap-1.5 pt-1">
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted/40" />
          <div className="h-5 w-20 animate-pulse rounded-full bg-muted/40" />
        </div>
        <div className="pt-2">
          <div className="h-6 w-32 animate-pulse rounded bg-muted/60" />
          <div className="mt-1 h-3 w-24 animate-pulse rounded bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

export function ResultsGridSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between px-1 pb-3">
        <div className="h-4 w-20 animate-pulse rounded bg-muted/40" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SKELETON_KEYS.map((key) => (
          <ListingCardSkeleton key={key} />
        ))}
      </div>
    </div>
  );
}

export function MarketplacePageSkeleton() {
  return (
    <div className="space-y-6">
      <MarketplaceHeroSkeleton />
      <CategoryPillsSkeleton />
      <section className="pa-marketplace-shell overflow-hidden rounded-[30px] border border-border/75">
        <div className="border-border/70 border-b px-4 py-3">
          <div className="h-4 w-32 animate-pulse rounded bg-muted/40" />
        </div>
        <div className="p-3 sm:p-4 lg:p-5">
          <ResultsGridSkeleton />
        </div>
      </section>
    </div>
  );
}
