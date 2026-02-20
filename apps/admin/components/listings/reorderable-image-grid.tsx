"use client";

import Image from "next/image";
import { useCallback, useRef, useState } from "react";

type ReorderableImageGridProps = {
  urls: string[];
  onReorder: (urls: string[]) => void;
  onRemove: (url: string) => void;
};

export function ReorderableImageGrid({
  urls,
  onReorder,
  onRemove,
}: ReorderableImageGridProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const dragNode = useRef<HTMLButtonElement | null>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      dragNode.current = e.currentTarget;
      setDragIndex(index);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
      requestAnimationFrame(() => {
        if (dragNode.current) {
          dragNode.current.style.opacity = "0.4";
        }
      });
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    if (dragNode.current) {
      dragNode.current.style.opacity = "1";
    }
    setDragIndex(null);
    setOverIndex(null);
    dragNode.current = null;
  }, []);

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOverIndex(index);
    },
    []
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLButtonElement>, targetIndex: number) => {
      e.preventDefault();
      if (dragIndex === null || dragIndex === targetIndex) {
        handleDragEnd();
        return;
      }
      const next = [...urls];
      const [moved] = next.splice(dragIndex, 1);
      next.splice(targetIndex, 0, moved);
      onReorder(next);
      handleDragEnd();
    },
    [dragIndex, urls, onReorder, handleDragEnd]
  );

  if (urls.length === 0) return null;

  return (
    <div className="grid grid-cols-4 gap-2 md:grid-cols-5">
      {urls.map((url, index) => (
        <div
          className={`group relative aspect-square overflow-hidden rounded-lg border-2 transition-colors ${
            overIndex === index && dragIndex !== index
              ? "border-primary"
              : "border-transparent"
          }`}
          key={url}
        >
          <button
            aria-label={`Reorder image ${index + 1}`}
            className="absolute inset-0"
            draggable
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragStart={(e) => handleDragStart(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            type="button"
          >
            <Image
              alt={`Image ${index + 1}`}
              className="h-full w-full cursor-grab object-cover active:cursor-grabbing"
              draggable={false}
              fill
              sizes="(max-width: 768px) 25vw, 20vw"
              src={url}
            />
          </button>
          <span className="absolute top-1 left-1 flex h-5 min-w-5 items-center justify-center rounded bg-black/60 px-1 font-bold text-[10px] text-white">
            {index + 1}
          </span>
          <button
            className="absolute -top-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 font-bold text-white text-xs opacity-0 transition-opacity group-hover:opacity-100"
            onClick={() => onRemove(url)}
            type="button"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
