"use client";

import Image from "next/image";
import { useState } from "react";

import { asText } from "./marketplace-types";
import { ImageLightbox } from "./image-lightbox";

type ListingGalleryLightboxProps = {
  title: string;
  coverImageUrl: string;
  galleryImageUrls: unknown[];
  isEn: boolean;
};

export function ListingGalleryLightbox({
  title,
  coverImageUrl,
  galleryImageUrls,
  isEn,
}: ListingGalleryLightboxProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const images = [
    coverImageUrl,
    ...galleryImageUrls.map((item) => asText(item).trim()).filter(Boolean),
  ].filter(Boolean);

  if (!images.length) {
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-2xl bg-[var(--marketplace-bg-muted)] text-[var(--marketplace-text-muted)] text-sm">
        {isEn ? "No images" : "Sin imágenes"}
      </div>
    );
  }

  const [first, ...rest] = images;
  const thumbnails = Array.from(new Set(rest)).slice(0, 4);
  const hasMore = images.length > 5;

  return (
    <>
      <section className="grid gap-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <button
          className="group relative min-w-0 overflow-hidden rounded-2xl"
          onClick={() => setLightboxIndex(0)}
          type="button"
        >
          <Image
            alt={title}
            className="h-full max-h-[540px] w-full object-cover transition-[transform,filter] duration-300 group-hover:scale-[1.02] group-hover:brightness-[0.97]"
            height={1080}
            loading="eager"
            sizes="(max-width: 1024px) 100vw, 66vw"
            src={first}
            width={1600}
          />
        </button>

        <div className="grid max-h-[540px] min-w-0 grid-cols-2 gap-2 overflow-hidden lg:grid-cols-1">
          {thumbnails.map((url, idx) => (
            <button
              className="group relative overflow-hidden rounded-xl"
              key={url}
              onClick={() => setLightboxIndex(idx + 1)}
              type="button"
            >
              <Image
                alt={`${title} ${idx + 2}`}
                className="h-full min-h-[112px] w-full object-cover transition-[transform,filter] duration-300 group-hover:scale-[1.02] group-hover:brightness-[0.97]"
                height={720}
                loading="lazy"
                sizes="(max-width: 1024px) 50vw, 33vw"
                src={url}
                width={1080}
              />

              {/* "Show all photos" overlay on last thumbnail */}
              {idx === thumbnails.length - 1 && hasMore ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                  <span className="font-serif text-lg font-medium text-white">
                    +{images.length - 5} {isEn ? "photos" : "fotos"}
                  </span>
                </div>
              ) : null}
            </button>
          ))}
        </div>
      </section>

      {lightboxIndex !== null ? (
        <ImageLightbox
          alt={title}
          images={images}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </>
  );
}
