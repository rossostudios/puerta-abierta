import Image from "next/image";

import { asText } from "./marketplace-types";

export function ListingGallery({
  title,
  coverImageUrl,
  galleryImageUrls,
}: {
  title: string;
  coverImageUrl: string;
  galleryImageUrls: unknown[];
}) {
  const images = [
    coverImageUrl,
    ...galleryImageUrls.map((item) => asText(item).trim()).filter(Boolean),
  ].filter(Boolean);

  if (!images.length) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-2xl border border-border/70 bg-muted/30 text-muted-foreground text-sm">
        No image
      </div>
    );
  }

  const [first, ...rest] = images;
  const thumbnailImages = Array.from(new Set(rest)).slice(0, 4);

  return (
    <section className="grid gap-3 lg:grid-cols-[2fr_1fr]">
      <div className="overflow-hidden rounded-2xl border border-border/70">
        <Image
          alt={title}
          className="h-full max-h-[540px] w-full object-cover"
          height={1080}
          loading="eager"
          sizes="(max-width: 1024px) 100vw, 66vw"
          src={first}
          unoptimized
          width={1600}
        />
      </div>
      <div className="grid max-h-[540px] grid-cols-2 gap-3 overflow-auto lg:grid-cols-1">
        {thumbnailImages.map((url, index) => (
          <div
            className="overflow-hidden rounded-xl border border-border/70"
            key={url}
          >
            <Image
              alt={`${title} ${index + 2}`}
              className="h-full min-h-[112px] w-full object-cover"
              height={720}
              loading="lazy"
              sizes="(max-width: 1024px) 50vw, 33vw"
              src={url}
              unoptimized
              width={1080}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
