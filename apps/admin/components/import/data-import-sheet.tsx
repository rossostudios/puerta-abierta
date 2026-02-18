"use client";

import { Upload01Icon } from "@hugeicons/core-free-icons";
import { useCallback, useMemo, useState } from "react";

import {
  batchCreateLeases,
  batchCreateProperties,
  batchCreateUnits,
  type ImportRowResult,
} from "@/app/(admin)/setup/import-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";

import {
  autoDetectMappings,
  ColumnMapper,
  LEASE_FIELDS,
  PROPERTY_FIELDS,
  UNIT_FIELDS,
} from "./column-mapper";
import { ImportProgress } from "./import-progress";

const EMPTY_RECORDS: Array<{ id: string; name: string; code?: string }> = [];

type ImportMode = "properties" | "units" | "leases";

type DataImportSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ImportMode;
  orgId: string;
  isEn: boolean;
  /** For unit imports: resolve property_name to property_id */
  properties?: Array<{ id: string; name: string; code?: string }>;
  /** For lease imports: resolve unit_name to unit_id */
  units?: Array<{ id: string; name: string; code?: string }>;
  onImportComplete?: () => void;
};

type DataRow = Record<string, string>;

type MappingEntry = { csvHeader: string; targetField: string };

/** Convert any cell value from read-excel-file to a plain string. */
function cellToString(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function isExcelFile(name: string): boolean {
  return /\.xlsx$/i.test(name);
}

function resolvePropertyId(
  value: string,
  properties: Array<{ id: string; name: string; code?: string }>
): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  for (const p of properties) {
    if (p.name.toLowerCase() === normalized) return p.id;
    if (p.code && p.code.toLowerCase() === normalized) return p.id;
    if (p.id === value.trim()) return p.id;
  }
  return null;
}

export function DataImportSheet({
  open,
  onOpenChange,
  mode,
  orgId,
  isEn,
  properties = EMPTY_RECORDS,
  units = EMPTY_RECORDS,
  onImportComplete,
}: DataImportSheetProps) {
  const [data, setData] = useState<DataRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportRowResult[]>([]);
  const [importProcessed, setImportProcessed] = useState(0);
  const [importDone, setImportDone] = useState(false);

  // Excel sheet picker state
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [pickingSheet, setPickingSheet] = useState(false);

  const targetFields =
    mode === "properties"
      ? PROPERTY_FIELDS
      : mode === "units"
        ? UNIT_FIELDS
        : LEASE_FIELDS;
  const csvTemplateUrl =
    mode === "properties"
      ? "/templates/properties-template.csv"
      : mode === "units"
        ? "/templates/units-template.csv"
        : "/templates/leases-template.csv";
  const xlsxTemplateUrl =
    mode === "properties"
      ? "/templates/properties-template.xlsx"
      : mode === "units"
        ? "/templates/units-template.xlsx"
        : "/templates/leases-template.xlsx";

  const reset = useCallback(() => {
    setData([]);
    setHeaders([]);
    setMappings([]);
    setFileName("");
    setParseError("");
    setImporting(false);
    setImportResults([]);
    setImportProcessed(0);
    setImportDone(false);
    setPendingFile(null);
    setSheetNames([]);
    setPickingSheet(false);
  }, []);

  /** Feed parsed headers + rows into the column mapping pipeline. */
  const finalizeParse = useCallback(
    (fileHeaders: string[], rows: DataRow[], name: string) => {
      if (rows.length === 0) {
        setParseError(isEn ? "File is empty" : "El archivo está vacío");
        return;
      }
      setHeaders(fileHeaders);
      setData(rows);
      setFileName(name);
      setMappings(autoDetectMappings(fileHeaders, targetFields));
      setPendingFile(null);
      setSheetNames([]);
      setPickingSheet(false);
    },
    [isEn, targetFields]
  );

  /** Parse an Excel sheet by index. */
  const parseExcelSheet = useCallback(
    async (file: File, sheetIndex?: number) => {
      try {
        const readXlsxFile = (await import("read-excel-file")).default;

        // Check for multi-sheet: read sheet names first
        const { readSheetNames } = await import("read-excel-file");
        const names = await readSheetNames(file);

        if (names.length > 1 && sheetIndex === undefined) {
          // Show sheet picker
          setPendingFile(file);
          setSheetNames(names);
          setPickingSheet(true);
          setFileName(file.name);
          return;
        }

        const sheet = sheetIndex ?? 1; // read-excel-file uses 1-based index
        const rows = await readXlsxFile(file, { sheet });

        if (rows.length === 0) {
          setParseError(isEn ? "Sheet is empty" : "La hoja está vacía");
          return;
        }

        // First row = headers
        const fileHeaders = rows[0].map((cell) => cellToString(cell));
        const dataRows = rows.slice(1).map((row) => {
          const obj: DataRow = {};
          for (let i = 0; i < fileHeaders.length; i++) {
            obj[fileHeaders[i]] = cellToString(row[i]);
          }
          return obj;
        });

        finalizeParse(fileHeaders, dataRows, file.name);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        if (message.includes("password") || message.includes("encrypted")) {
          setParseError(
            isEn
              ? "This file is password-protected. Please remove the password and try again."
              : "Este archivo está protegido con contraseña. Elimina la contraseña e intenta de nuevo."
          );
        } else {
          setParseError(
            isEn
              ? `Could not read Excel file: ${message}`
              : `No se pudo leer el archivo Excel: ${message}`
          );
        }
      }
    },
    [isEn, finalizeParse]
  );

  const handleSheetSelect = useCallback(
    (index: number) => {
      if (!pendingFile) return;
      setPickingSheet(false);
      setParseError("");
      parseExcelSheet(pendingFile, index + 1); // 1-based
    },
    [pendingFile, parseExcelSheet]
  );

  const handleFile = useCallback(
    async (file: File) => {
      setParseError("");
      setImportDone(false);
      setImportResults([]);
      setImportProcessed(0);
      setPickingSheet(false);
      setSheetNames([]);
      setPendingFile(null);

      if (isExcelFile(file.name)) {
        parseExcelSheet(file);
        return;
      }

      // CSV / TSV parsing via PapaParse (dynamically loaded)
      const PapaParse = (await import("papaparse")).default;
      PapaParse.parse<DataRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          if (result.errors.length > 0) {
            setParseError(result.errors[0].message);
            return;
          }
          const fileHeaders = result.meta.fields ?? Object.keys(result.data[0]);
          finalizeParse(fileHeaders, result.data, file.name);
        },
        error: (err) => {
          setParseError(err.message);
        },
      });
    },
    [parseExcelSheet, finalizeParse]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const onFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const validationErrors = useMemo(() => {
    const errors: string[] = [];
    const requiredFields = targetFields.filter((f) => f.required);
    for (const field of requiredFields) {
      if (!mappings.some((m) => m.targetField === field.key)) {
        errors.push(
          isEn
            ? `Required field "${field.label}" is not mapped`
            : `Campo requerido "${field.label}" no está mapeado`
        );
      }
    }
    return errors;
  }, [mappings, targetFields, isEn]);

  const handleImport = async () => {
    if (validationErrors.length > 0 || importing) return;
    setImporting(true);
    setImportResults([]);
    setImportProcessed(0);
    setImportDone(false);

    // Build mapped rows
    const mappedRows = data.map((row) => {
      const mapped: Record<string, string> = {};
      for (const m of mappings) {
        if (m.targetField) {
          mapped[m.targetField] = row[m.csvHeader] ?? "";
        }
      }
      return mapped;
    });

    if (mode === "properties") {
      const propertyPayloads = mappedRows.map((row) => ({
        name: row.name ?? "",
        code: row.code,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        city: row.city,
        region: row.region,
        postal_code: row.postal_code,
        country_code: row.country_code,
        latitude: row.latitude ? Number(row.latitude) : undefined,
        longitude: row.longitude ? Number(row.longitude) : undefined,
      }));
      const result = await batchCreateProperties(orgId, propertyPayloads);
      setImportResults(result.rows);
      setImportProcessed(result.total);
      setImportDone(true);
    } else if (mode === "leases") {
      const leasePayloads = mappedRows.map((row) => {
        const unitName = row.unit_name ?? "";
        const unitId = resolvePropertyId(unitName, units.map((u) => ({ id: u.id, name: u.name, code: u.code })));
        return {
          unit_id: unitId ?? "",
          tenant_full_name: row.tenant_full_name ?? "",
          tenant_email: row.tenant_email,
          tenant_phone_e164: row.tenant_phone_e164,
          starts_on: row.starts_on ?? "",
          ends_on: row.ends_on,
          monthly_rent: row.monthly_rent ? Number(row.monthly_rent) : 0,
          currency: row.currency || "PYG",
          security_deposit: row.security_deposit ? Number(row.security_deposit) : undefined,
          service_fee_flat: row.service_fee_flat ? Number(row.service_fee_flat) : undefined,
          notes: row.notes,
        };
      });
      const result = await batchCreateLeases(orgId, leasePayloads);
      setImportResults(result.rows);
      setImportProcessed(result.total);
      setImportDone(true);
    } else {
      const unitPayloads = mappedRows.map((row) => {
        const propertyName = row.property_name ?? "";
        const propertyId = resolvePropertyId(propertyName, properties);
        return {
          property_id: propertyId ?? "",
          code: row.code ?? "",
          name: row.name ?? "",
          max_guests: row.max_guests ? Number(row.max_guests) : undefined,
          bedrooms: row.bedrooms ? Number(row.bedrooms) : undefined,
          bathrooms: row.bathrooms ? Number(row.bathrooms) : undefined,
          square_meters: row.square_meters
            ? Number(row.square_meters)
            : undefined,
          default_nightly_rate: row.default_nightly_rate
            ? Number(row.default_nightly_rate)
            : undefined,
          default_cleaning_fee: row.default_cleaning_fee
            ? Number(row.default_cleaning_fee)
            : undefined,
          currency: row.currency || undefined,
          check_in_time: row.check_in_time || undefined,
          check_out_time: row.check_out_time || undefined,
          is_active: row.is_active
            ? !["false", "0", "no", "inactivo"].includes(
                row.is_active.trim().toLowerCase()
              )
            : undefined,
        };
      });
      const result = await batchCreateUnits(orgId, unitPayloads);
      setImportResults(result.rows);
      setImportProcessed(result.total);
      setImportDone(true);
    }

    setImporting(false);
    onImportComplete?.();
  };

  const previewRows = data.slice(0, 5);
  const showDropZone = data.length === 0 && !importDone && !pickingSheet;

  return (
    <Sheet
      description={
        mode === "properties"
          ? isEn
            ? "Import properties from a CSV or Excel file."
            : "Importar propiedades desde un archivo CSV o Excel."
          : mode === "units"
            ? isEn
              ? "Import units from a CSV or Excel file."
              : "Importar unidades desde un archivo CSV o Excel."
            : isEn
              ? "Import leases from a CSV or Excel file."
              : "Importar contratos desde un archivo CSV o Excel."
      }
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
      title={
        mode === "properties"
          ? isEn
            ? "Import properties"
            : "Importar propiedades"
          : mode === "units"
            ? isEn
              ? "Import units"
              : "Importar unidades"
            : isEn
              ? "Import leases"
              : "Importar contratos"
      }
    >
      <div className="space-y-5">
        {/* Download templates */}
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
          <span className="text-sm text-muted-foreground">
            {isEn ? "Download template" : "Descargar plantilla"}
          </span>
          <div className="flex items-center gap-3">
            <a
              className="text-sm font-medium text-primary hover:underline"
              download
              href={csvTemplateUrl}
            >
              CSV
            </a>
            <a
              className="text-sm font-medium text-primary hover:underline"
              download
              href={xlsxTemplateUrl}
            >
              Excel
            </a>
          </div>
        </div>

        {/* File drop zone */}
        {showDropZone ? (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center transition-colors hover:border-primary/30 hover:bg-muted/20"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
          >
            <Icon className="text-muted-foreground" icon={Upload01Icon} size={32} />
            <div>
              <p className="text-sm font-medium text-foreground">
                {isEn
                  ? "Drop your CSV or Excel file here"
                  : "Suelta tu archivo CSV o Excel aquí"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isEn ? "or click to select" : "o haz clic para seleccionar"}
              </p>
            </div>
            <label className="cursor-pointer rounded-md border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted/50">
              {isEn ? "Select file" : "Seleccionar archivo"}
              <input
                accept=".csv,.tsv,.txt,.xlsx"
                className="hidden"
                onChange={onFileSelect}
                type="file"
              />
            </label>
          </div>
        ) : null}

        {/* Sheet picker for multi-sheet Excel files */}
        {pickingSheet && sheetNames.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">
                {sheetNames.length} {isEn ? "sheets" : "hojas"}
              </span>
            </div>
            <p className="text-xs font-medium text-muted-foreground">
              {isEn
                ? "This file has multiple sheets. Select one to import:"
                : "Este archivo tiene varias hojas. Selecciona una para importar:"}
            </p>
            <div className="grid gap-2">
              {sheetNames.map((name, i) => (
                <button
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-left text-sm font-medium transition-colors hover:border-primary/40 hover:bg-primary/5"
                  key={i}
                  onClick={() => handleSheetSelect(i)}
                  type="button"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-xs font-semibold text-primary">
                    {i + 1}
                  </span>
                  {name}
                </button>
              ))}
            </div>
            <div className="flex justify-end">
              <Button onClick={reset} type="button" variant="outline">
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
            </div>
          </div>
        ) : null}

        {parseError ? (
          <Alert variant="destructive">
            <AlertTitle>{isEn ? "Parse error" : "Error de lectura"}</AlertTitle>
            <AlertDescription>{parseError}</AlertDescription>
          </Alert>
        ) : null}

        {/* Column mapper */}
        {headers.length > 0 && !importDone ? (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground">
                {data.length} {isEn ? "rows" : "filas"}
              </span>
            </div>

            <ColumnMapper
              csvHeaders={headers}
              isEn={isEn}
              mappings={mappings}
              onMappingChange={setMappings}
              targetFields={targetFields}
            />

            {validationErrors.length > 0 ? (
              <Alert variant="warning">
                <AlertTitle>
                  {isEn ? "Mapping issues" : "Problemas de mapeo"}
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {validationErrors.map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {/* Preview table */}
            {previewRows.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">
                  {isEn ? "Preview (first 5 rows)" : "Vista previa (primeras 5 filas)"}
                </p>
                <div className="max-h-48 overflow-auto rounded-lg border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        {headers.map((h) => (
                          <th
                            className="px-2 py-1.5 text-left font-medium text-muted-foreground"
                            key={h}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr className="border-b" key={i}>
                          {headers.map((h) => (
                            <td className="px-2 py-1.5" key={h}>
                              {row[h] || "\u2014"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button
                onClick={reset}
                type="button"
                variant="outline"
              >
                {isEn ? "Cancel" : "Cancelar"}
              </Button>
              <Button
                disabled={importing || validationErrors.length > 0}
                onClick={handleImport}
                type="button"
              >
                {importing ? (
                  <>
                    <Spinner size="sm" className="text-primary-foreground" />
                    {isEn ? "Importing..." : "Importando..."}
                  </>
                ) : (
                  <>
                    {isEn ? "Import" : "Importar"} {data.length}{" "}
                    {isEn ? "rows" : "filas"}
                  </>
                )}
              </Button>
            </div>
          </>
        ) : null}

        {/* Import progress */}
        {importDone ? (
          <>
            <ImportProgress
              isEn={isEn}
              processed={importProcessed}
              results={importResults}
              total={data.length}
            />
            <div className="flex justify-end gap-2">
              <Button
                onClick={reset}
                type="button"
                variant="outline"
              >
                {isEn ? "Import more" : "Importar más"}
              </Button>
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                type="button"
              >
                {isEn ? "Done" : "Listo"}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
