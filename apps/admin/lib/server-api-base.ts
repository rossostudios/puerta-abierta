const DEFAULT_SERVER_API_BASE_URL = "http://localhost:8000/v1";

export const SERVER_API_BASE_URL =
  process.env.INTERNAL_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  DEFAULT_SERVER_API_BASE_URL;

export function hasConfiguredServerApiBaseUrl(): boolean {
  return Boolean(
    process.env.INTERNAL_API_BASE_URL ||
      process.env.API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_BASE_URL
  );
}
