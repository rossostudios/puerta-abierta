"use client";

import { useEffect, useState } from "react";
import { HeartAddIcon } from "@hugeicons/core-free-icons";
import Link from "next/link";

import { MarketplaceListingCard } from "@/components/marketplace/listing-card";
import { PublicFooter } from "@/components/marketplace/public-footer";
import { PublicHeader } from "@/components/marketplace/public-header";
import { Icon } from "@/components/ui/icon";
import {
  FAVORITES_CHANGE_EVENT,
  getFavorites,
} from "@/lib/features/marketplace/favorites";
import type { MarketplaceListingViewModel } from "@/lib/features/marketplace/view-model";

export default function FavoritesPage() {
  const [locale] = useState<"es-PY" | "en-US">("es-PY");
  const [favoriteSlugs, setFavoriteSlugs] = useState<string[]>([]);
  const [allListings, setAllListings] = useState<MarketplaceListingViewModel[]>(
    []
  );
  const [loading, setLoading] = useState(true);

  const isEn = locale === "en-US";

  // Read favorites from localStorage
  useEffect(() => {
    setFavoriteSlugs(getFavorites());

    function sync() {
      setFavoriteSlugs(getFavorites());
    }
    window.addEventListener(FAVORITES_CHANGE_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_CHANGE_EVENT, sync);
  }, []);

  // Fetch all listings client-side and filter
  useEffect(() => {
    if (!favoriteSlugs.length) {
      setLoading(false);
      return;
    }

    async function fetchListings() {
      try {
        const res = await fetch("/api/marketplace/listings?limit=120");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        setAllListings(data.listings ?? []);
      } catch {
        // Silently fail
      } finally {
        setLoading(false);
      }
    }

    fetchListings();
  }, [favoriteSlugs.length]);

  const favoriteListings = allListings.filter((l) =>
    favoriteSlugs.includes(l.slug)
  );

  return (
    <div className="pa-marketplace-root min-h-dvh bg-background">
      <PublicHeader locale={locale} />

      <main className="mx-auto w-full max-w-[1560px] space-y-6 px-3 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
        <header>
          <h1 className="font-semibold text-[1.8rem] tracking-tight">
            {isEn ? "Your favorites" : "Tus favoritos"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {isEn
              ? "Listings you've saved for later."
              : "Anuncios que guardaste para después."}
          </p>
        </header>

        {loading ? (
          <div className="py-20 text-center text-muted-foreground text-sm">
            {isEn ? "Loading..." : "Cargando..."}
          </div>
        ) : favoriteSlugs.length === 0 ? (
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted/50">
              <Icon
                className="text-muted-foreground"
                icon={HeartAddIcon}
                size={28}
              />
            </div>
            <div>
              <p className="font-medium">
                {isEn ? "No favorites yet" : "Sin favoritos todavía"}
              </p>
              <p className="mt-1 text-muted-foreground text-sm">
                {isEn
                  ? "Tap the heart icon on any listing to save it here."
                  : "Toca el corazón en cualquier anuncio para guardarlo aquí."}
              </p>
            </div>
            <Link
              className="inline-flex h-10 items-center rounded-xl bg-primary px-5 font-medium text-primary-foreground text-sm"
              href="/marketplace"
            >
              {isEn ? "Browse listings" : "Explorar anuncios"}
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {favoriteListings.map((listing) => (
              <MarketplaceListingCard
                key={listing.slug}
                listing={listing.raw}
                locale={locale}
              />
            ))}
          </div>
        )}
      </main>

      <PublicFooter locale={locale} />
    </div>
  );
}
