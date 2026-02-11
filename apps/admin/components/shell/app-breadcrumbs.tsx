"use client";

import { usePathname } from "next/navigation";
import { Fragment, useMemo } from "react";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { Locale } from "@/lib/i18n";
import { getModuleLabel, MODULE_BY_SLUG } from "@/lib/modules";

type Crumb = {
  label: string;
  href?: string;
  current?: boolean;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORD_START_RE = /\b\w/g;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function shortId(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function humanizeSegment(value: string): string {
  return value
    .replaceAll("-", " ")
    .replaceAll("_", " ")
    .replace(WORD_START_RE, (char) => char.toUpperCase());
}

function buildCrumbs(pathname: string, locale: Locale): Crumb[] {
  const isEn = locale === "en-US";
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "app")) {
    return [{ label: isEn ? "Dashboard" : "Panel", current: true }];
  }

  const crumbs: Crumb[] = [
    { label: isEn ? "Dashboard" : "Panel", href: "/app" },
  ];

  if (parts[0] === "setup") {
    crumbs.push({ label: isEn ? "Setup" : "Configuración", current: true });
    return crumbs;
  }

  if (parts[0] === "account") {
    crumbs.push({ label: isEn ? "Account" : "Cuenta", current: true });
    return crumbs;
  }

  if (parts[0] === "module") {
    const slug = parts[1] ?? "";
    const id = parts[2] ?? null;
    const moduleDef = MODULE_BY_SLUG.get(slug);
    crumbs.push({
      label: moduleDef?.label
        ? getModuleLabel(moduleDef, locale)
        : humanizeSegment(slug || (isEn ? "Module" : "Módulo")),
      href: slug ? `/module/${slug}` : undefined,
      current: !id,
    });
    if (id) {
      crumbs.push({
        label: isUuid(id) ? shortId(id) : humanizeSegment(id),
        current: true,
      });
    }
    return crumbs;
  }

  // Fallback: best-effort.
  const collected: string[] = [];
  for (const [index, part] of parts.entries()) {
    collected.push(part);
    const href = `/${collected.join("/")}`;
    crumbs.push({
      label: humanizeSegment(part),
      href: index === parts.length - 1 ? undefined : href,
      current: index === parts.length - 1,
    });
  }

  return crumbs;
}

export function AppBreadcrumbs({
  className,
  locale,
}: {
  className?: string;
  locale: Locale;
}) {
  const pathname = usePathname();
  const crumbs = useMemo(
    () => buildCrumbs(pathname, locale),
    [pathname, locale]
  );

  if (!crumbs.length) return null;

  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        {crumbs.map((crumb, index) => (
          <Fragment key={`${crumb.label}-${index}`}>
            <BreadcrumbItem>
              {crumb.current ? (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              ) : crumb.href ? (
                <BreadcrumbLink href={crumb.href} prefetch={false}>
                  {crumb.label}
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{crumb.label}</span>
              )}
            </BreadcrumbItem>
            {index < crumbs.length - 1 ? <BreadcrumbSeparator /> : null}
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
