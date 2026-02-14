const STORAGE_KEY = "pa-marketplace-recently-viewed";
const MAX_ITEMS = 10;

function readQueue(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(slug: string): void {
  const queue = readQueue().filter((s) => s !== slug);
  queue.unshift(slug);
  if (queue.length > MAX_ITEMS) queue.length = MAX_ITEMS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function getRecentlyViewed(): string[] {
  return readQueue();
}

export function clearRecentlyViewed(): void {
  localStorage.removeItem(STORAGE_KEY);
}
