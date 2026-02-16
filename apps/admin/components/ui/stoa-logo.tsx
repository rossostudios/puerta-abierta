export function StoaLogo({
  size = 24,
  color = "currentColor",
  className,
}: {
  size?: number;
  color?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 32 32"
      width={size}
    >
      <line
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2"
        x1="5"
        x2="27"
        y1="5.5"
        y2="5.5"
      />
      <line
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2"
        x1="5"
        x2="27"
        y1="26.5"
        y2="26.5"
      />
      <rect
        fill={color}
        height="21"
        opacity="0.9"
        rx="0.75"
        width="3.5"
        x="7.5"
        y="5.5"
      />
      <rect
        fill={color}
        height="21"
        opacity="0.55"
        rx="0.75"
        width="3.5"
        x="14.25"
        y="5.5"
      />
      <rect
        fill={color}
        height="21"
        opacity="0.3"
        rx="0.75"
        width="3.5"
        x="21"
        y="5.5"
      />
    </svg>
  );
}
