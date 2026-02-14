const STORAGE_KEY = "pa-marketplace-favorites";
const EVENT_NAME = "pa-favorites-change";

function readSlugs(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeSlugs(slugs: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(slugs));
  window.dispatchEvent(new CustomEvent(EVENT_NAME));
}

export function getFavorites(): string[] {
  return readSlugs();
}

export function isFavorite(slug: string): boolean {
  return readSlugs().includes(slug);
}

export function toggleFavorite(slug: string): boolean {
  const slugs = readSlugs();
  const index = slugs.indexOf(slug);
  if (index >= 0) {
    slugs.splice(index, 1);
    writeSlugs(slugs);
    return false;
  }
  slugs.push(slug);
  writeSlugs(slugs);
  return true;
}

export function getFavoritesCount(): number {
  return readSlugs().length;
}

export { EVENT_NAME as FAVORITES_CHANGE_EVENT };
