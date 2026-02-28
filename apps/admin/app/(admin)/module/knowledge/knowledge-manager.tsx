"use client";

import {
  Cancel01Icon,
  Search01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { authedFetch, getClientAccessToken } from "@/lib/api-client";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000/v1";

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

type SearchResult = {
  chunk_id: string;
  content: string;
  vector_score: number | null;
  fts_score: number | null;
  rrf_score: number | null;
  document_title: string;
};

type Props = {
  orgId: string;
  initialDocuments: unknown[];
  locale: string;
};

const ACCEPTED_FILE_TYPES = ".pdf,.docx,.txt,.md";
const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
];

export function KnowledgeManager({ orgId, initialDocuments, locale }: Props) {
  const isEn = locale === "en-US";
  const [documents, setDocuments] = useState<KnowledgeDocument[]>(
    (initialDocuments as KnowledgeDocument[]) ?? []
  );
  const [showCreateForm, setShowCreateForm] = useState(false);
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
  const [isSeeding, setIsSeeding] = useState(false);

  // File upload state
  const [isDragging, setIsDragging] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Search test state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Stats computed from documents
  const stats = useMemo(() => {
    const totalDocs = documents.length;
    const totalChunks = documents.reduce(
      (sum, d) => sum + (d.chunk_count ?? 0),
      0
    );
    const embeddedDocs = documents.filter((d) => d.has_embeddings).length;
    return { totalDocs, totalChunks, embeddedDocs };
  }, [documents]);

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
      setShowCreateForm(false);
      await refreshDocuments();
    } catch (err) {
      console.error("Failed to create knowledge document:", err);
    } finally {
      setIsCreating(false);
    }
  }, [orgId, newTitle, newContent, newSourceUrl, refreshDocuments]);

  const handleSeed = useCallback(async () => {
    setIsSeeding(true);
    try {
      await fetch("/api/knowledge/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_id: orgId }),
      });
      await refreshDocuments();
    } catch (err) {
      console.error("Failed to seed knowledge base:", err);
    } finally {
      setIsSeeding(false);
    }
  }, [orgId, refreshDocuments]);

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

  // --- File upload handlers ---

  const handleFileDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && ACCEPTED_MIME_TYPES.includes(file.type)) {
        setUploadFile(file);
        if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
      }
    },
    [uploadTitle]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setUploadFile(file);
        if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
      }
    },
    [uploadTitle]
  );

  const handleFileUpload = useCallback(async () => {
    if (!uploadFile) return;
    setIsUploading(true);
    setUploadProgress(isEn ? "Uploading file..." : "Subiendo archivo...");

    try {
      const token = await getClientAccessToken();
      const formData = new FormData();
      formData.append("organization_id", orgId);
      formData.append("file", uploadFile);
      if (uploadTitle.trim()) {
        formData.append("title", uploadTitle.trim());
      }

      setUploadProgress(
        isEn
          ? "Processing and embedding content..."
          : "Procesando e indexando contenido..."
      );

      const res = await fetch(`${API_BASE}/knowledge-documents/upload`, {
        method: "POST",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Upload failed (${res.status}): ${text}`);
      }

      setUploadFile(null);
      setUploadTitle("");
      setUploadProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refreshDocuments();
    } catch (err) {
      console.error("Failed to upload file:", err);
      setUploadProgress(
        isEn
          ? "Upload failed. Please try again."
          : "Error al subir. Intente de nuevo."
      );
    } finally {
      setIsUploading(false);
    }
  }, [uploadFile, uploadTitle, orgId, isEn, refreshDocuments]);

  // --- Search test handler ---

  const handleSearchTest = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const res = await authedFetch<{ data: SearchResult[] }>(
        "/knowledge-documents/search-test",
        {
          method: "POST",
          body: JSON.stringify({
            org_id: orgId,
            query: searchQuery.trim(),
            limit: 10,
          }),
        }
      );
      setSearchResults(res.data ?? []);
    } catch (err) {
      console.error("Search test failed:", err);
    } finally {
      setIsSearching(false);
    }
  }, [orgId, searchQuery]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString(locale, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatScore = (score: number | null) => {
    if (score === null || score === undefined) return "-";
    return score.toFixed(4);
  };

  return (
    <div className="space-y-6">
      {/* Stats row */}
      {documents.length > 0 && (
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5">
            <span className="text-muted-foreground text-xs">
              {isEn ? "Documents" : "Documentos"}
            </span>
            <span className="font-medium text-sm tabular-nums">
              {stats.totalDocs}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5">
            <span className="text-muted-foreground text-xs">
              {isEn ? "Chunks" : "Fragmentos"}
            </span>
            <span className="font-medium text-sm tabular-nums">
              {stats.totalChunks}
            </span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/50 px-3 py-1.5">
            <span className="text-muted-foreground text-xs">
              {isEn ? "Embedded" : "Indexados"}
            </span>
            <span className="font-medium text-sm tabular-nums">
              {stats.embeddedDocs}/{stats.totalDocs}
            </span>
          </div>
        </div>
      )}

      {/* Header row — Documents label + count + Add button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-medium text-sm">
            {isEn ? "Documents" : "Documentos"}
          </h3>
          <Badge className="text-[10px] tabular-nums" variant="secondary">
            {documents.length}
          </Badge>
        </div>
        <Button
          className="h-7 text-xs"
          onClick={() => setShowCreateForm((v) => !v)}
          size="sm"
          variant="ghost"
        >
          {showCreateForm
            ? isEn
              ? "Cancel"
              : "Cancelar"
            : isEn
              ? "+ Add Document"
              : "+ Agregar Documento"}
        </Button>
      </div>

      {/* Create form — progressive disclosure */}
      {showCreateForm && (
        <div className="space-y-3 rounded-lg border border-border/50 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={isEn ? "Document title" : "Titulo del documento"}
              value={newTitle}
            />
            <Input
              onChange={(e) => setNewSourceUrl(e.target.value)}
              placeholder={
                isEn ? "Source URL (optional)" : "URL de origen (opcional)"
              }
              value={newSourceUrl}
            />
          </div>
          <Textarea
            onChange={(e) => setNewContent(e.target.value)}
            placeholder={
              isEn
                ? "Paste document content here. It will be split into chunks and embedded for AI search."
                : "Pegue el contenido del documento aqui. Se dividira en fragmentos y se indexara para busqueda IA."
            }
            rows={5}
            value={newContent}
          />
          <div className="flex items-center gap-3">
            <Button
              disabled={isCreating || !newTitle.trim()}
              onClick={handleCreate}
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
              <p className="animate-pulse text-muted-foreground text-xs">
                {isEn
                  ? "Splitting and embedding content..."
                  : "Dividiendo e indexando contenido..."}
              </p>
            )}
          </div>
        </div>
      )}

      {/* File upload dropzone */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm">
          {isEn ? "File Upload" : "Subir Archivo"}
        </h4>
        <div
          className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border/50 hover:border-border"
          }`}
          onDragEnter={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={handleFileDrop}
        >
          <Icon
            className="text-muted-foreground"
            icon={Upload01Icon}
            size={24}
          />
          <p className="text-center text-muted-foreground text-sm">
            {isDragging
              ? isEn
                ? "Drop file here"
                : "Suelte el archivo aqui"
              : isEn
                ? "Drag & drop a file here, or click to browse"
                : "Arrastre un archivo aqui, o haga clic para buscar"}
          </p>
          <p className="text-center text-muted-foreground/60 text-xs">
            PDF, DOCX, TXT, MD
          </p>
          <input
            accept={ACCEPTED_FILE_TYPES}
            className="absolute inset-0 cursor-pointer opacity-0"
            onChange={handleFileSelect}
            ref={fileInputRef}
            type="file"
          />
        </div>

        {uploadFile && (
          <div className="flex items-center gap-3 rounded-lg border border-border/50 p-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <Badge className="shrink-0 text-[10px]" variant="secondary">
                  {uploadFile.name.split(".").pop()?.toUpperCase()}
                </Badge>
                <span className="truncate text-sm">{uploadFile.name}</span>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {(uploadFile.size / 1024).toFixed(1)} KB
                </span>
              </div>
              <Input
                className="h-8 text-sm"
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder={
                  isEn
                    ? "Document title (optional)"
                    : "Titulo del documento (opcional)"
                }
                value={uploadTitle}
              />
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                disabled={isUploading}
                onClick={handleFileUpload}
                size="sm"
              >
                {isUploading
                  ? isEn
                    ? "Uploading..."
                    : "Subiendo..."
                  : isEn
                    ? "Upload"
                    : "Subir"}
              </Button>
              <Button
                className="h-8 w-8"
                disabled={isUploading}
                onClick={() => {
                  setUploadFile(null);
                  setUploadTitle("");
                  setUploadProgress("");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                size="sm"
                variant="ghost"
              >
                <Icon icon={Cancel01Icon} size={14} />
              </Button>
            </div>
          </div>
        )}

        {uploadProgress && (
          <div className="flex items-center gap-2">
            {isUploading && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full animate-pulse rounded-full bg-primary/60"
                  style={{ width: "60%" }}
                />
              </div>
            )}
            <p
              className={`shrink-0 text-xs ${
                isUploading
                  ? "animate-pulse text-muted-foreground"
                  : "text-destructive"
              }`}
            >
              {uploadProgress}
            </p>
          </div>
        )}
      </div>

      {/* Document list */}
      {documents.length === 0 && (
        <div className="rounded-lg border border-border/50 py-12 text-center">
          <p className="mb-3 text-muted-foreground text-sm">
            {isEn ? "No knowledge documents yet." : "No hay documentos aun."}
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button
              className="text-xs"
              onClick={() => setShowCreateForm(true)}
              size="sm"
              variant="ghost"
            >
              {isEn ? "+ Add Document" : "+ Agregar Documento"}
            </Button>
            <Button
              className="text-xs"
              disabled={isSeeding}
              onClick={handleSeed}
              size="sm"
              variant="outline"
            >
              {isSeeding
                ? isEn
                  ? "Seeding..."
                  : "Sembrando..."
                : isEn
                  ? "Seed Knowledge Base"
                  : "Sembrar Base de Conocimiento"}
            </Button>
          </div>
          {isSeeding && (
            <p className="mt-3 animate-pulse text-muted-foreground text-xs">
              {isEn
                ? "Creating and embedding 5 default documents — this may take a minute..."
                : "Creando e indexando 5 documentos predeterminados — esto puede tomar un minuto..."}
            </p>
          )}
        </div>
      )}

      {documents.length > 0 && (
        <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50">
          {documents.map((doc) => (
            <div
              className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/20"
              key={doc.id}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium text-sm">{doc.title}</p>
                  <Badge
                    className="shrink-0 text-[10px] tabular-nums"
                    variant="secondary"
                  >
                    {doc.chunk_count ?? 0} {isEn ? "chunks" : "fragmentos"}
                  </Badge>
                  {doc.has_embeddings ? (
                    <Badge
                      className="status-tone-success shrink-0 text-[10px]"
                      variant="outline"
                    >
                      {isEn ? "Embedded" : "Indexado"}
                    </Badge>
                  ) : (
                    <Badge className="shrink-0 text-[10px]" variant="outline">
                      {isEn ? "Not embedded" : "Sin indexar"}
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-muted-foreground text-xs">
                  {doc.created_at && <span>{formatDate(doc.created_at)}</span>}
                  {doc.source_url && (
                    <>
                      <span>·</span>
                      <a
                        className="underline transition-colors hover:text-foreground"
                        href={doc.source_url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {isEn ? "source" : "origen"}
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  className="h-7 text-xs"
                  onClick={() => handleViewChunks(doc)}
                  size="sm"
                  variant="ghost"
                >
                  {isEn ? "View" : "Ver"}
                </Button>
                {confirmDeleteId === doc.id ? (
                  <div className="flex items-center gap-1">
                    <Button
                      className="h-7 text-destructive text-xs hover:text-destructive"
                      onClick={() => handleDelete(doc.id)}
                      size="sm"
                      variant="ghost"
                    >
                      {isEn ? "Confirm" : "Confirmar"}
                    </Button>
                    <Button
                      className="h-7 text-xs"
                      onClick={() => setConfirmDeleteId(null)}
                      size="sm"
                      variant="ghost"
                    >
                      <Icon icon={Cancel01Icon} size={12} />
                    </Button>
                  </div>
                ) : (
                  <Button
                    className="h-7 text-destructive text-xs hover:text-destructive"
                    onClick={() => setConfirmDeleteId(doc.id)}
                    size="sm"
                    variant="ghost"
                  >
                    {isEn ? "Delete" : "Eliminar"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Test Search panel */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm">
          {isEn ? "Test Search" : "Busqueda de Prueba"}
        </h4>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Icon
              className="absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
              icon={Search01Icon}
              size={14}
            />
            <Input
              className="h-9 pl-9 text-sm"
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearchTest();
              }}
              placeholder={
                isEn
                  ? "Enter a query to test hybrid search..."
                  : "Ingrese una consulta para probar busqueda hibrida..."
              }
              value={searchQuery}
            />
          </div>
          <Button
            disabled={isSearching || !searchQuery.trim()}
            onClick={handleSearchTest}
            size="sm"
          >
            {isSearching
              ? isEn
                ? "Searching..."
                : "Buscando..."
              : isEn
                ? "Search"
                : "Buscar"}
          </Button>
        </div>

        {isSearching && (
          <p className="animate-pulse text-muted-foreground text-xs">
            {isEn
              ? "Running hybrid vector + full-text search..."
              : "Ejecutando busqueda hibrida vector + texto completo..."}
          </p>
        )}

        {!isSearching && searchResults.length > 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              {searchResults.length} {isEn ? "results" : "resultados"}
            </p>
            <div className="divide-y divide-border/40 overflow-hidden rounded-lg border border-border/50">
              {searchResults.map((result, idx) => (
                <div className="space-y-2 px-4 py-3" key={result.chunk_id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      className="shrink-0 text-[10px] tabular-nums"
                      variant="secondary"
                    >
                      #{idx + 1}
                    </Badge>
                    <span className="truncate font-medium text-xs">
                      {result.document_title}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Badge
                        className="text-[10px] tabular-nums"
                        variant="outline"
                      >
                        vec: {formatScore(result.vector_score)}
                      </Badge>
                      <Badge
                        className="text-[10px] tabular-nums"
                        variant="outline"
                      >
                        fts: {formatScore(result.fts_score)}
                      </Badge>
                      <Badge
                        className="status-tone-success text-[10px] tabular-nums"
                        variant="outline"
                      >
                        rrf: {formatScore(result.rrf_score)}
                      </Badge>
                    </div>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-relaxed">
                    {result.content}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {!isSearching &&
          searchResults.length === 0 &&
          searchQuery.trim() !== "" && (
            <p className="text-muted-foreground text-xs">
              {isEn
                ? "No results. Try a different query or add more documents."
                : "Sin resultados. Intente otra consulta o agregue mas documentos."}
            </p>
          )}
      </div>

      {/* Chunks sheet */}
      <Sheet
        description={`${chunks.length} ${isEn ? "chunks" : "fragmentos"}`}
        onOpenChange={setSheetOpen}
        open={sheetOpen}
        title={selectedDoc?.title}
      >
        <div>
          {loadingChunks && (
            <p className="animate-pulse py-4 text-muted-foreground text-sm">
              {isEn ? "Loading..." : "Cargando..."}
            </p>
          )}
          {!loadingChunks && chunks.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-muted-foreground text-sm">
                {isEn
                  ? "No chunks found. Process the document to create chunks."
                  : "No se encontraron fragmentos. Procese el documento para crear fragmentos."}
              </p>
            </div>
          )}
          {chunks.length > 0 && (
            <div className="divide-y divide-border/40">
              {chunks.map((chunk) => (
                <div className="space-y-1.5 py-3" key={chunk.id}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-muted-foreground text-xs tabular-nums">
                      {isEn ? "Chunk" : "Fragmento"} #{chunk.chunk_index}
                    </span>
                    {chunk.has_embedding ? (
                      <Badge
                        className="status-tone-success text-[10px]"
                        variant="outline"
                      >
                        {isEn ? "embedded" : "indexado"}
                      </Badge>
                    ) : (
                      <Badge className="text-[10px]" variant="outline">
                        {isEn ? "no vector" : "sin vector"}
                      </Badge>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}
