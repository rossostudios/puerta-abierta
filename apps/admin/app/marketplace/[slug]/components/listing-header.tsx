import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ListingHeaderProps = {
  isEn: boolean;
  title: string;
  city: string;
  neighborhood: string;
  summary: string;
  specsLong: string;
};

export function ListingHeader({
  isEn,
  title,
  city,
  neighborhood,
  summary,
  specsLong,
}: ListingHeaderProps) {
  return (
    <header className="space-y-3">
      <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} href="/marketplace">
        {isEn ? "Back to marketplace" : "Volver al marketplace"}
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{city}</Badge>
        {neighborhood ? <Badge variant="outline">{neighborhood}</Badge> : null}
      </div>

      <h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">{title}</h1>
      {summary ? <p className="max-w-3xl text-muted-foreground">{summary}</p> : null}
      {specsLong ? <p className="text-muted-foreground text-sm">{specsLong}</p> : null}
    </header>
  );
}
