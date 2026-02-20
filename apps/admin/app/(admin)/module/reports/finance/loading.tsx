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
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-72" />
            </div>
            <Skeleton className="h-9 w-24" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => `kpi-${index}`).map(
              (kpiKey) => (
                <Skeleton className="h-[100px] rounded-xl" key={kpiKey} />
              )
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, index) => `chart-${index}`).map(
              (chartKey) => (
                <Skeleton className="h-[280px] rounded-xl" key={chartKey} />
              )
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
