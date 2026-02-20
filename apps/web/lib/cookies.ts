// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: protocol inference intentionally checks multiple proxy/header scenarios.
export function shouldUseSecureCookie(headers: Headers, url?: string): boolean {
  const forwardedProto = headers.get("x-forwarded-proto");
  if (forwardedProto) {
    const first = forwardedProto.split(",")[0]?.trim().toLowerCase();
    if (first === "https") return true;
    if (first === "http") return false;
  }

  const origin = headers.get("origin") ?? headers.get("referer");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol === "https:") return true;
      if (parsed.protocol === "http:") return false;
    } catch {
      // Ignore parse failures.
    }
  }

  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") return true;
      if (parsed.protocol === "http:") return false;
    } catch {
      // Ignore parse failures.
    }
  }

  const host = (headers.get("host") ?? "").toLowerCase();
  if (
    host.startsWith("localhost") ||
    host.startsWith("127.0.0.1") ||
    host.startsWith("[::1]")
  ) {
    return false;
  }

  return process.env.NODE_ENV === "production";
}
