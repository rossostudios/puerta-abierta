import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-5">
      {/* Page header skeleton */}
      <div className="rounded-3xl border border-border/80 bg-card/98 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
          <div className="grid w-full gap-2 sm:grid-cols-3 md:w-auto md:min-w-[40rem]">
            {Array.from({ length: 3 }, (_, index) => `header-${index}`).map(
              (headerKey) => (
                <Skeleton className="h-[72px] rounded-2xl" key={headerKey} />
              )
            )}
          </div>
        </div>
      </div>

      {/* Hero metrics skeleton */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => `hero-${index}`).map(
          (heroKey) => (
            <Skeleton className="h-[100px] rounded-xl" key={heroKey} />
          )
        )}
      </div>

      {/* Operations skeleton */}
      <div className="rounded-3xl border border-border/80 bg-card/98 p-4 sm:p-5">
        <Skeleton className="mb-3 h-3 w-24" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => `ops-${index}`).map(
            (opsKey) => (
              <Skeleton className="h-[100px] rounded-xl" key={opsKey} />
            )
          )}
        </div>
      </div>

      {/* Charts skeleton */}
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => `chart-${index}`).map(
          (chartKey) => (
            <Skeleton className="h-[280px] rounded-xl" key={chartKey} />
          )
        )}
      </div>
    </div>
  );
}
