import Image from "next/image";

export function CasaoraLogo({
  className,
  size = 32,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span className={className}>
      <Image
        alt="Casaora"
        className="block dark:hidden"
        height={size}
        src="/casaora-light.svg"
        width={size}
      />
      <Image
        alt="Casaora"
        className="hidden dark:block"
        height={size}
        src="/casaora-dark.svg"
        width={size}
      />
    </span>
  );
}
