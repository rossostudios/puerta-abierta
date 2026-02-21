"use client";

import { useCallback, useState } from "react";
import {
  BookOpen01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  File02Icon,
  Upload04Icon,
} from "@hugeicons/core-free-icons";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type KnowledgeDocument = {
  id: string;
  title: string;
  source_url?: string | null;
  chunk_count?: number;
  has_embeddings?: boolean;
  created_at?: string;
};

type KnowledgeChunk = {
  id: string;
  chunk_index: number;
  content: string;
  has_embedding: boolean;
};

type Props = {
  orgId: string;
  initialDocuments: unknown[];
  locale: string;
};

export function KnowledgeManager({ orgId, initialDocuments, locale }: Props) {
  const isEn = locale === "en-US";
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(
    (initialDocuments as KnowledgeDocument[]) ?? []
  );
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<KnowledgeDocument | null>(
    null
  );
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);
  const [loadingChunks, setLoadingChunks] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await authedFetch<{ data: KnowledgeDocument[] }>(
        `/knowledge-documents?org_id=${orgId}&limit=200`
      );
      setDocuments(res.data ?? []);
    } catch {
      // silently fail — page already shows initial data
    }
  }, [orgId]);

  const handleCreate = useCallback(async () => {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    try {
      await authedFetch<KnowledgeDocument>("/knowledge-documents", {
        method: "POST",
        body: JSON.stringify({
          organization_id: orgId,
          title: newTitle.trim(),
          source_url: newSourceUrl.trim() || undefined,
          content: newContent.trim() || undefined,
        }),
      });
      setNewTitle("");
      setNewContent("");
      setNewSourceUrl("");
      await refreshDocuments();
    } catch (err) {
      console.error("Failed to create knowledge document:", err);
    } finally {
      setIsCreating(false);
    }
  }, [orgId, newTitle, newContent, newSourceUrl, refreshDocuments]);

  const handleDelete = useCallback(
    async (docId: string) => {
      try {
        await authedFetch(`/knowledge-documents/${docId}`, {
          method: "DELETE",
        });
        setDocuments((prev) => prev.filter((d) => d.id !== docId));
        setConfirmDeleteId(null);
        if (selectedDoc?.id === docId) {
          setSelectedDoc(null);
          setChunks([]);
          setSheetOpen(false);
        }
      } catch (err) {
        console.error("Failed to delete:", err);
      }
    },
    [selectedDoc]
  );

  const handleViewChunks = useCallback(
    async (doc: KnowledgeDocument) => {
      setSelectedDoc(doc);
      setSheetOpen(true);
      setLoadingChunks(true);
      try {
        const res = await authedFetch<{ data: KnowledgeChunk[] }>(
          `/knowledge-documents/${doc.id}/chunks?org_id=${orgId}&limit=500`
        );
        setChunks(res.data ?? []);
      } catch {
        setChunks([]);
      } finally {
        setLoadingChunks(false);
      }
    },
    [orgId]
  );

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-6">
      {/* Create new document */}
      <div className="glass-inner rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Icon icon={Upload04Icon} size={14} className="text-muted-foreground" />
          <h3 className="font-medium text-sm">
            {isEn
              ? "Add Knowledge Document"
              : "Agregar Documento de Conocimiento"}
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            placeholder={isEn ? "Document title" : "Titulo del documento"}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Input
            placeholder={
              isEn ? "Source URL (optional)" : "URL de origen (opcional)"
            }
            value={newSourceUrl}
            onChange={(e) => setNewSourceUrl(e.target.value)}
          />
        </div>
        <Textarea
          placeholder={
            isEn
              ? "Paste document content here. It will be split into chunks and embedded for AI search."
              : "Pegue el contenido del documento aqui. Se dividira en fragmentos y se indexara para busqueda IA."
          }
          rows={5}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={handleCreate}
            disabled={isCreating || !newTitle.trim()}
            size="sm"
          >
            {isCreating
              ? isEn
                ? "Processing..."
                : "Procesando..."
              : isEn
                ? "Add & Process"
                : "Agregar y Procesar"}
          </Button>
          {isCreating && (
            <p className="text-xs text-muted-foreground animate-pulse">
              {isEn
                ? "Splitting and embedding content..."
                : "Dividiendo e indexando contenido..."}
            </p>
          )}
        </div>
      </div>

      {/* Document list */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-sm">
            {isEn ? "Documents" : "Documentos"}
          </h3>
          <Badge variant="secondary" className="text-[10px] tabular-nums">
            {documents.length}
          </Badge>
        </div>

        {documents.length === 0 && (
          <div className="glass-inner flex flex-col items-center justify-center rounded-2xl py-12">
            <Icon
              icon={BookOpen01Icon}
              size={32}
              className="text-muted-foreground/30 mb-3"
            />
            <p className="text-sm text-muted-foreground">
              {isEn
                ? "No knowledge documents yet. Add one above."
                : "No hay documentos aun. Agregue uno arriba."}
            </p>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="glass-inner rounded-xl p-4 space-y-3 transition-all hover:shadow-sm"
            >
              <div className="flex items-start gap-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-muted/50 mt-0.5">
                  <Icon
                    icon={File02Icon}
                    size={14}
                    className="text-muted-foreground"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm truncate">{doc.title}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <Badge
                      variant="secondary"
                      className="text-[10px] tabular-nums"
                    >
                      {doc.chunk_count ?? 0}{" "}
                      {isEn ? "chunks" : "fragmentos"}
                    </Badge>
                    {doc.has_embeddings ? (
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] status-tone-success"
                        )}
                      >
                        <Icon
                          icon={CheckmarkCircle02Icon}
                          size={10}
                          className="mr-0.5"
                        />
                        {isEn ? "Embedded" : "Indexado"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        {isEn ? "Not embedded" : "Sin indexar"}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  {doc.created_at && (
                    <span>{formatDate(doc.created_at)}</span>
                  )}
                  {doc.source_url && (
                    <>
                      <span>·</span>
                      <a
                        href={doc.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground transition-colors"
                      >
                        {isEn ? "source" : "origen"}
                      </a>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => handleViewChunks(doc)}
                  >
                    {isEn ? "View" : "Ver"}
                  </Button>
                  {confirmDeleteId === doc.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive hover:text-destructive"
                        onClick={() => handleDelete(doc.id)}
                      >
                        {isEn ? "Confirm" : "Confirmar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        <Icon icon={Cancel01Icon} size={12} />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={() => setConfirmDeleteId(doc.id)}
                    >
                      {isEn ? "Delete" : "Eliminar"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chunks sheet */}
      <Sheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title={selectedDoc?.title}
        description={`${chunks.length} ${isEn ? "chunks" : "fragmentos"}`}
      >
        <div className="space-y-3">
          {loadingChunks && (
            <p className="text-sm text-muted-foreground animate-pulse">
              {isEn ? "Loading..." : "Cargando..."}
            </p>
          )}
          {!loadingChunks && chunks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <Icon
                icon={File02Icon}
                size={28}
                className="text-muted-foreground/30 mb-2"
              />
              <p className="text-sm text-muted-foreground">
                {isEn
                  ? "No chunks found. Process the document to create chunks."
                  : "No se encontraron fragmentos. Procese el documento para crear fragmentos."}
              </p>
            </div>
          )}
          {chunks.map((chunk, i) => (
            <div key={chunk.id}>
              {i > 0 && (
                <div className="h-px bg-border/50 my-3" />
              )}
              <div className="glass-inner rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground tabular-nums">
                    {isEn ? "Chunk" : "Fragmento"} #{chunk.chunk_index}
                  </span>
                  {chunk.has_embedding ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] status-tone-success"
                    >
                      {isEn ? "embedded" : "indexado"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      {isEn ? "no vector" : "sin vector"}
                    </Badge>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {chunk.content}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
