"use client";

const SIZE = 24;
const STROKE = 3;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function colorForScore(score: number): string {
  if (score >= 80) return "#10b981"; // emerald-500
  if (score >= 50) return "#f59e0b"; // amber-500
  return "#ef4444"; // red-500
}

export function ReadinessRing({ score }: { score: number }) {
  const pct = Math.max(0, Math.min(100, score));
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  const color = colorForScore(pct);

  return (
    <svg
      aria-label={`Readiness ${pct}%`}
      className="shrink-0"
      height={SIZE}
      role="img"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
    >
      <title>{`Readiness ${pct}%`}</title>
      <circle
        className="stroke-muted/40"
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        strokeWidth={STROKE}
      />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        fill="none"
        r={RADIUS}
        stroke={color}
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        strokeLinecap="round"
        strokeWidth={STROKE}
        style={{ transform: "rotate(-90deg)", transformOrigin: "center" }}
      />
    </svg>
  );
}
