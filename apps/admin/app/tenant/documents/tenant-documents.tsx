"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v ? String(v) : "";
}

type Document = Record<string, unknown>;

export function TenantDocuments({ locale }: { locale: string }) {
  const isEn = locale === "en-US";
  const router = useRouter();
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDocs = useCallback(async () => {
    const token = localStorage.getItem("tenant_token");
    if (!token) {
      router.push("/tenant/login");
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/tenant/documents`, {
        headers: { "x-tenant-token": token },
      });
      if (res.status === 401) {
        localStorage.clear();
        router.push("/tenant/login");
        return;
      }
      const data = await res.json();
      setDocs(Array.isArray(data.data) ? data.data : []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-muted-foreground animate-pulse">
          {isEn ? "Loading..." : "Cargando..."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          {isEn ? "Documents" : "Documentos"}
        </h1>
        <Link href="/tenant/dashboard">
          <Button size="sm" variant="outline">
            {isEn ? "Back" : "Volver"}
          </Button>
        </Link>
      </div>

      {docs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              {isEn
                ? "No documents available yet."
                : "No hay documentos disponibles."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {docs.map((doc) => {
            const id = asString(doc.id);
            const title = asString(doc.title) || asString(doc.name) || (isEn ? "Document" : "Documento");
            const docType = asString(doc.document_type);
            const url = asString(doc.url) || asString(doc.file_url);
            const createdAt = asString(doc.created_at);

            return (
              <Card key={id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      {docType && (
                        <p className="text-muted-foreground text-xs capitalize">
                          {docType.replace(/_/g, " ")}
                        </p>
                      )}
                      {createdAt && (
                        <p className="text-muted-foreground text-xs">
                          {new Date(createdAt).toLocaleDateString(locale)}
                        </p>
                      )}
                    </div>
                    {url && (
                      <a
                        className="text-primary text-sm font-medium underline"
                        href={url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {isEn ? "Download" : "Descargar"}
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
