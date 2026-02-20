import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-5 w-24" />
              </div>
              <Skeleton className="h-8 w-56" />
              <Skeleton className="h-4 w-80" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* View toggle + actions */}
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-10 w-28" />
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>

          {/* Navigation bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-8 w-8" />
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-8 w-8" />
            </div>
            <Skeleton className="h-4 w-32" />
          </div>

          {/* Grid skeleton */}
          <div className="rounded-xl border border-border/60">
            <div className="space-y-0">
              {/* Header */}
              <div className="flex border-border/40 border-b bg-muted/50 p-2">
                <Skeleton className="h-4 w-full" />
              </div>
              {/* Rows */}
              {[45, 65, 35, 55, 70, 40].map((w) => (
                <div
                  className="flex items-center gap-2 border-border/40 border-b px-3 py-3"
                  key={w}
                >
                  <Skeleton className="h-4 w-28 shrink-0" />
                  <Skeleton className={`h-6 w-[${w}%]`} />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
