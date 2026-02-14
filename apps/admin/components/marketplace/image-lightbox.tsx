"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { createPortal } from "react-dom";

import { Icon } from "@/components/ui/icon";

type ImageLightboxProps = {
  images: string[];
  initialIndex?: number;
  alt: string;
  onClose: () => void;
};

export function ImageLightbox({
  images,
  initialIndex = 0,
  alt,
  onClose,
}: ImageLightboxProps) {
  const [index, setIndex] = useState(initialIndex);

  const goNext = useCallback(() => {
    setIndex((i) => (i + 1) % images.length);
  }, [images.length]);

  const goPrev = useCallback(() => {
    setIndex((i) => (i - 1 + images.length) % images.length);
  }, [images.length]);

  // Keyboard navigation
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    document.addEventListener("keydown", handleKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [onClose, goNext, goPrev]);

  // Preload adjacent images
  useEffect(() => {
    const nextIdx = (index + 1) % images.length;
    const prevIdx = (index - 1 + images.length) % images.length;
    for (const idx of [nextIdx, prevIdx]) {
      const img = new Image();
      img.src = images[idx];
    }
  }, [index, images]);

  // Touch swipe
  const [touchStart, setTouchStart] = useState<number | null>(null);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      {/* Counter */}
      <div className="absolute top-4 left-4 z-10 rounded-full bg-black/60 px-3 py-1.5 text-sm text-white">
        {index + 1} / {images.length}
      </div>

      {/* Close */}
      <button
        className="absolute top-4 right-4 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
        onClick={onClose}
        type="button"
      >
        <Icon icon={Cancel01Icon} size={20} />
      </button>

      {/* Prev */}
      {images.length > 1 ? (
        <button
          className="absolute left-4 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          type="button"
        >
          <Icon icon={ArrowLeft01Icon} size={24} />
        </button>
      ) : null}

      {/* Image */}
      <img
        alt={`${alt} ${index + 1}`}
        className="max-h-[90vh] max-w-[90vw] select-none object-contain"
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => {
          if (touchStart === null) return;
          const diff = e.changedTouches[0].clientX - touchStart;
          if (Math.abs(diff) > 60) {
            diff > 0 ? goPrev() : goNext();
          }
          setTouchStart(null);
        }}
        onTouchStart={(e) => setTouchStart(e.touches[0].clientX)}
        src={images[index]}
      />

      {/* Next */}
      {images.length > 1 ? (
        <button
          className="absolute right-4 z-10 rounded-full bg-black/60 p-2 text-white transition-colors hover:bg-black/80"
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          type="button"
        >
          <Icon icon={ArrowRight01Icon} size={24} />
        </button>
      ) : null}
    </div>,
    document.body
  );
}
