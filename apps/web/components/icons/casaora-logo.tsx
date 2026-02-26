import { cn } from "@/lib/utils";

export function CasaoraLogo({
  className,
  size = 24,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <span
      aria-label="Casaora"
      className={cn(
        "inline-flex select-none items-center font-medium tracking-tight",
        className
      )}
      style={{ fontSize: `${size}px`, lineHeight: 1, fontFamily: "var(--font-diatype)" }}
    >
      casaora
    </span>
  );
}
