import { Add01Icon } from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type PageHeaderProps = {
  title: string;
  description: string;
  recordCount: number;
  recordsLabel: string;
  primaryActionLabel: string;
  onPrimaryAction: () => void;
  primaryActionDisabled?: boolean;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  secondaryActionDisabled?: boolean;
};

export function PageHeader({
  title,
  description,
  recordCount,
  recordsLabel,
  primaryActionLabel,
  onPrimaryAction,
  primaryActionDisabled,
  secondaryActionLabel,
  onSecondaryAction,
  secondaryActionDisabled,
}: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <h1 className="font-bold text-2xl text-foreground tracking-tight">
            {title}
          </h1>
          <Badge
            className="h-5 border-primary/20 bg-primary/10 px-1.5 font-bold text-[10px] text-primary uppercase tracking-wider"
            variant="secondary"
          >
            {recordCount} {recordsLabel}
          </Badge>
        </div>
        <p className="font-medium text-muted-foreground text-sm">
          {description}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {onSecondaryAction ? (
          <Button
            className="h-9 rounded-xl"
            disabled={secondaryActionDisabled}
            onClick={onSecondaryAction}
            type="button"
            variant="outline"
          >
            {secondaryActionLabel ?? "Import"}
          </Button>
        ) : null}
        <Button
          className="h-9 rounded-xl bg-primary px-4 font-semibold text-white transition-all hover:bg-primary/90"
          disabled={primaryActionDisabled}
          onClick={onPrimaryAction}
          type="button"
        >
          <Icon icon={Add01Icon} size={16} />
          {primaryActionLabel}
        </Button>
      </div>
    </header>
  );
}
