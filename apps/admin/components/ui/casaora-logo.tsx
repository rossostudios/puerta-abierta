import { cn } from "@/lib/utils";

export function CasaoraLogo({
  className,
  size = 32,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-label="Casaora"
      className={cn(
        "inline-flex select-none items-center font-medium tracking-tight",
        className
      )}
      role="img"
      style={{ fontSize: `${size}px`, lineHeight: 1 }}
    >
      casaora
    </span>
  );
}
