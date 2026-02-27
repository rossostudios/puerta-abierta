import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { MODULES } from "@/lib/modules";

export type ScanWarning = {
  source: "api" | "db" | "modules" | "runtime";
  message: string;
  detail?: string;
};

export type RouteDocItem = {
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
  path: string;
  statusCode: number;
  authHint: "require_user_id" | "require_authenticated_user" | "none";
  sourceFile: string;
  handler: string;
};

export type TableColumnDocItem = {
  name: string;
  type: string;
  nullable: boolean;
};

export type TableDocItem = {
  name: string;
  columns: TableColumnDocItem[];
};

export type ModuleDocItem = {
  slug: string;
  label: string;
  labelEn: string;
  endpoint: string;
  description: string;
  descriptionEn: string;
};

export type DocumentationSnapshot = {
  generatedAt: string;
  routes: RouteDocItem[];
  tables: TableDocItem[];
  modules: ModuleDocItem[];
  warnings: ScanWarning[];
};

const ROUTERS_RELATIVE_DIR = path.join(
  "apps",
  "backend",
  "app",
  "api",
  "routers"
);
const SCHEMA_RELATIVE_FILE = path.join("db", "schema.sql");

const ENDPOINT_REGEX =
  /@router\.(get|post|patch|delete|put)\(\s*["']([^"']+)["']([\s\S]*?)\)\s*\n(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
const CREATE_TABLE_REGEX = /CREATE TABLE\s+("?[\w.]+"?)\s*\(([\s\S]*?)\);\s*/gi;
const STATUS_CODE_REGEX = /status_code\s*=\s*(\d+)/i;
const STRIP_QUOTES_REGEX = /^"+|"+$/g;
const AUTH_AUTHENTICATED_REGEX = /Depends\(\s*require_authenticated_user\s*\)/;
const AUTH_USER_ID_REGEX = /Depends\(\s*require_user_id\s*\)/;
const PUBLIC_PREFIX_REGEX = /^public\./;
const COLUMN_LINE_REGEX = /^("?[\w]+"?)\s+(.+)$/;
const NOT_NULL_REGEX = /\bNOT\s+NULL\b/i;
const COLUMN_STOP_REGEX =
  /\s+(?:NOT\s+NULL|NULL|DEFAULT|REFERENCES|CHECK|CONSTRAINT|PRIMARY\s+KEY|UNIQUE|GENERATED)\b/i;

function resolveRepoRoot(): string | null {
  const cwd = process.cwd();
  const candidates = Array.from(
    new Set([
      cwd,
      path.resolve(cwd, ".."),
      path.resolve(cwd, "../.."),
      path.resolve(cwd, "../../.."),
    ])
  );

  for (const candidate of candidates) {
    const routersDir = path.join(candidate, ROUTERS_RELATIVE_DIR);
    const schemaFile = path.join(candidate, SCHEMA_RELATIVE_FILE);
    if (existsSync(routersDir) && existsSync(schemaFile)) {
      return candidate;
    }
  }

  return null;
}

function parseStatusCode(rawDecoratorArgs: string): number {
  const match = rawDecoratorArgs.match(STATUS_CODE_REGEX);
  if (!match) return 200;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : 200;
}

function parseAuthHint(block: string): RouteDocItem["authHint"] {
  if (AUTH_AUTHENTICATED_REGEX.test(block)) {
    return "require_authenticated_user";
  }
  if (AUTH_USER_ID_REGEX.test(block)) {
    return "require_user_id";
  }
  return "none";
}

function parseRoutesFromFile(
  sourceFile: string,
  content: string
): RouteDocItem[] {
  const matches = Array.from(content.matchAll(ENDPOINT_REGEX));
  if (matches.length === 0) {
    return [];
  }

  const routes: RouteDocItem[] = [];
  for (const [index, match] of matches.entries()) {
    const method = String(match[1] ?? "")
      .trim()
      .toUpperCase() as RouteDocItem["method"];
    const routePath = String(match[2] ?? "").trim();
    const decoratorArgs = String(match[3] ?? "");
    const handler = String(match[4] ?? "").trim();

    if (!(method && routePath && handler)) {
      continue;
    }

    const start = match.index ?? 0;
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? content.length)
        : content.length;
    const functionBlock = content.slice(start, end);

    routes.push({
      method,
      path: routePath,
      statusCode: parseStatusCode(decoratorArgs),
      authHint: parseAuthHint(functionBlock),
      sourceFile,
      handler,
    });
  }

  return routes;
}

function parseApiRoutes(repoRoot: string): RouteDocItem[] {
  const routersDir = path.join(repoRoot, ROUTERS_RELATIVE_DIR);
  const fileNames = readdirSync(routersDir)
    .filter((file) => file.endsWith(".py"))
    .sort((a, b) => a.localeCompare(b));

  const routes: RouteDocItem[] = [];
  for (const fileName of fileNames) {
    const absolutePath = path.join(routersDir, fileName);
    const sourceFile = path
      .relative(repoRoot, absolutePath)
      .replaceAll("\\", "/");
    const content = readFileSync(absolutePath, "utf-8");
    routes.push(...parseRoutesFromFile(sourceFile, content));
  }

  return routes.sort((left, right) => {
    const pathCompare = left.path.localeCompare(right.path);
    if (pathCompare !== 0) return pathCompare;

    const methodCompare = left.method.localeCompare(right.method);
    if (methodCompare !== 0) return methodCompare;

    const fileCompare = left.sourceFile.localeCompare(right.sourceFile);
    if (fileCompare !== 0) return fileCompare;

    return left.handler.localeCompare(right.handler);
  });
}

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .replace(STRIP_QUOTES_REGEX, "")
    .replace(PUBLIC_PREFIX_REGEX, "");
}

function parseColumnLine(line: string): TableColumnDocItem | null {
  const withoutComment = line.split("--")[0]?.trim() ?? "";
  if (!withoutComment) return null;

  const cleaned = withoutComment.endsWith(",")
    ? withoutComment.slice(0, -1).trim()
    : withoutComment;
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();
  if (
    upper.startsWith("CONSTRAINT ") ||
    upper.startsWith("PRIMARY KEY") ||
    upper.startsWith("FOREIGN KEY") ||
    upper.startsWith("UNIQUE ") ||
    upper.startsWith("CHECK ") ||
    upper.startsWith("EXCLUDE ")
  ) {
    return null;
  }

  const match = cleaned.match(COLUMN_LINE_REGEX);
  if (!match) return null;

  const name = normalizeIdentifier(match[1]);
  const definition = (match[2] ?? "").trim();
  if (!(name && definition)) return null;

  const stopIndex = definition.search(COLUMN_STOP_REGEX);
  const type =
    stopIndex >= 0 ? definition.slice(0, stopIndex).trim() : definition.trim();

  if (!type) return null;

  return {
    name,
    type,
    nullable: !NOT_NULL_REGEX.test(definition),
  };
}

function parseDbTables(repoRoot: string): TableDocItem[] {
  const schemaFile = path.join(repoRoot, SCHEMA_RELATIVE_FILE);
  const content = readFileSync(schemaFile, "utf-8");

  const tables: TableDocItem[] = [];
  const matches = Array.from(content.matchAll(CREATE_TABLE_REGEX));
  for (const match of matches) {
    const tableName = normalizeIdentifier(String(match[1] ?? ""));
    const tableBody = String(match[2] ?? "");
    if (!tableName) continue;

    const columns = tableBody
      .split("\n")
      .map((line) => parseColumnLine(line))
      .filter((column): column is TableColumnDocItem => Boolean(column));

    tables.push({
      name: tableName,
      columns,
    });
  }

  return tables.sort((left, right) => left.name.localeCompare(right.name));
}

function parseModules(): ModuleDocItem[] {
  return MODULES.map((module) => ({
    slug: module.slug,
    label: module.label,
    labelEn: module.label_en ?? module.label,
    endpoint: module.endpoint,
    description: module.description,
    descriptionEn: module.description_en ?? module.description,
  })).sort((left, right) => left.slug.localeCompare(right.slug));
}

export function buildDocumentationSnapshot(): DocumentationSnapshot {
  const warnings: ScanWarning[] = [];

  const modules = (() => {
    try {
      return parseModules();
    } catch (err) {
      warnings.push({
        source: "modules",
        message: "Could not parse module definitions.",
        detail: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  })();

  const repoRoot = resolveRepoRoot();
  if (!repoRoot) {
    warnings.push({
      source: "runtime",
      message: "Could not resolve repository root for API/DB scanning.",
      detail: `cwd=${process.cwd()}`,
    });
    return {
      generatedAt: new Date().toISOString(),
      routes: [],
      tables: [],
      modules,
      warnings,
    };
  }

  const routes = (() => {
    try {
      return parseApiRoutes(repoRoot);
    } catch (err) {
      warnings.push({
        source: "api",
        message: "Could not parse backend routers.",
        detail: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  })();

  const tables = (() => {
    try {
      return parseDbTables(repoRoot);
    } catch (err) {
      warnings.push({
        source: "db",
        message: "Could not parse database schema.",
        detail: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  })();

  if (routes.length === 0) {
    warnings.push({
      source: "api",
      message: "No API routes were discovered from router source files.",
    });
  }
  if (tables.length === 0) {
    warnings.push({
      source: "db",
      message: "No database tables were discovered from schema.sql.",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    routes,
    tables,
    modules,
    warnings,
  };
}
