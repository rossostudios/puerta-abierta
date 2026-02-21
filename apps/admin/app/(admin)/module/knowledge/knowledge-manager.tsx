"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet } from "@/components/ui/sheet";
import { authedFetch } from "@/lib/api-client";

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

  return (
    <div className="space-y-6">
      {/* Create new document */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium text-sm">
          {isEn ? "Add Knowledge Document" : "Agregar Documento de Conocimiento"}
        </h3>
        <Input
          placeholder={isEn ? "Document title" : "Título del documento"}
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <Input
          placeholder={isEn ? "Source URL (optional)" : "URL de origen (opcional)"}
          value={newSourceUrl}
          onChange={(e) => setNewSourceUrl(e.target.value)}
        />
        <Textarea
          placeholder={
            isEn
              ? "Paste document content here. It will be split into chunks and embedded for AI search."
              : "Pegue el contenido del documento aquí. Se dividirá en fragmentos y se indexará para búsqueda IA."
          }
          rows={6}
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
        />
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
      </div>

      {/* Document list */}
      <div className="space-y-2">
        <h3 className="font-medium text-sm">
          {isEn ? "Documents" : "Documentos"} ({documents.length})
        </h3>
        {documents.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "No knowledge documents yet. Add one above."
              : "No hay documentos aún. Agregue uno arriba."}
          </p>
        )}
        <div className="divide-y rounded-lg border">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {doc.title}
                  </span>
                  {doc.has_embeddings ? (
                    <Badge variant="secondary" className="text-xs shrink-0">
                      {isEn ? "Embedded" : "Indexado"}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs shrink-0">
                      {isEn ? "Not embedded" : "Sin indexar"}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {doc.chunk_count ?? 0} {isEn ? "chunks" : "fragmentos"}
                  {doc.source_url && (
                    <>
                      {" · "}
                      <a
                        href={doc.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {isEn ? "source" : "origen"}
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleViewChunks(doc)}
                >
                  {isEn ? "View" : "Ver"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleDelete(doc.id)}
                >
                  {isEn ? "Delete" : "Eliminar"}
                </Button>
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
            <p className="text-sm text-muted-foreground">
              {isEn ? "Loading..." : "Cargando..."}
            </p>
          )}
          {!loadingChunks && chunks.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {isEn
                ? "No chunks found. Process the document to create chunks."
                : "No se encontraron fragmentos. Procese el documento para crear fragmentos."}
            </p>
          )}
          {chunks.map((chunk) => (
            <div key={chunk.id} className="rounded border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  #{chunk.chunk_index}
                </span>
                {chunk.has_embedding ? (
                  <Badge variant="secondary" className="text-[10px]">
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
          ))}
        </div>
      </Sheet>
    </div>
  );
}
