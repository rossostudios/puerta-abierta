"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Locale } from "@/lib/i18n";

function asString(val: unknown): string {
  if (typeof val === "string") return val;
  return String(val ?? "");
}

function asNumber(val: unknown): number {
  if (typeof val === "number") return val;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
}

function _nestedStr(obj: unknown, key: string): string {
  if (obj && typeof obj === "object" && key in obj) {
    return asString((obj as Record<string, unknown>)[key]);
  }
  return "";
}

type PlatformManagerProps = {
  orgs: Record<string, unknown>[];
  locale: Locale;
};

export function PlatformManager({ orgs, locale }: PlatformManagerProps) {
  const isEn = locale === "en-US";
  const [search, setSearch] = useState("");

  const filtered = orgs.filter((org) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = asString(org.name).toLowerCase();
    const email = asString(org.contact_email).toLowerCase();
    const id = asString(org.id).toLowerCase();
    return name.includes(q) || email.includes(q) || id.includes(q);
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              {isEn ? "Organizations" : "Organizaciones"}
            </CardTitle>
            <CardDescription>
              {isEn
                ? `${orgs.length} registered organizations`
                : `${orgs.length} organizaciones registradas`}
            </CardDescription>
          </div>
          <Input
            className="w-64"
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              isEn
                ? "Search by name or email..."
                : "Buscar por nombre o email..."
            }
            value={search}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {filtered.map((org, i) => {
            const orgId = asString(org.id);
            const name = asString(org.name) || orgId.slice(0, 8);
            const status = asString(org.status) || "active";
            const memberCount = asNumber(org.member_count);
            const propertyCount = asNumber(org.property_count);
            const sub = org.subscription as Record<string, unknown> | null;
            const _planId = sub ? asString(sub.plan_id) : "";
            const subStatus = sub ? asString(sub.status) : "";
            const createdAt = asString(org.created_at).slice(0, 10);

            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
                key={orgId || i}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium text-sm">{name}</p>
                    <Badge
                      className="text-[10px]"
                      variant={
                        status === "active" ? "secondary" : "destructive"
                      }
                    >
                      {status}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {memberCount} {isEn ? "members" : "miembros"} ·{" "}
                    {propertyCount} {isEn ? "properties" : "propiedades"}
                    {createdAt &&
                      ` · ${isEn ? "Created" : "Creado"} ${createdAt}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {subStatus && (
                    <Badge
                      className={`text-[10px] ${
                        subStatus === "active"
                          ? "border-green-300 text-green-700 dark:border-green-700 dark:text-green-400"
                          : subStatus === "trialing"
                            ? "border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400"
                            : ""
                      }`}
                      variant="outline"
                    >
                      {subStatus}
                    </Badge>
                  )}
                  {!sub && (
                    <Badge
                      className="text-[10px] text-muted-foreground"
                      variant="outline"
                    >
                      {isEn ? "No plan" : "Sin plan"}
                    </Badge>
                  )}
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <p className="py-8 text-center text-muted-foreground text-sm">
              {isEn
                ? "No organizations match your search."
                : "Ninguna organización coincide con tu búsqueda."}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
