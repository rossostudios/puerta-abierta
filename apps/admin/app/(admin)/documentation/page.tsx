import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchMe } from "@/lib/api";
import { buildDocumentationSnapshot } from "@/lib/documentation/wiki";
import { NoOrgCard } from "@/lib/page-helpers";
import type { Locale } from "@/lib/i18n";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";
import { cn } from "@/lib/utils";

type DocumentationPageProps = {
  searchParams: Promise<{ q?: string }>;
};

type Membership = {
  organization_id?: string;
  role?: string;
};

function asQuery(value: string | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function hasQueryMatch(
  query: string,
  values: Array<string | undefined>
): boolean {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
}

function formatGeneratedAt(value: string, locale: Locale): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

export default async function DocumentationPage({
  searchParams,
}: DocumentationPageProps) {
  const [params, locale, orgId] = await Promise.all([
    searchParams,
    getActiveLocale(),
    getActiveOrgId(),
  ]);
  const isEn = locale === "en-US";
  const query = asQuery(params.q).toLowerCase();

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["the documentation workspace", "el espacio de documentación"]}
      />
    );
  }

  let activeRole = "";
  let roleError = "";
  try {
    const me = await fetchMe();
    const memberships = Array.isArray(me.memberships)
      ? (me.memberships as Membership[])
      : [];
    const membership =
      memberships.find((item) => item.organization_id === orgId) ?? null;
    activeRole = String(membership?.role ?? "")
      .trim()
      .toLowerCase();
  } catch (err) {
    roleError = err instanceof Error ? err.message : String(err);
  }

  if (activeRole !== "owner_admin") {
    return (
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Documentation" : "Documentación"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Restricted access" : "Acceso restringido"}
            </Badge>
          </div>
          <CardTitle>
            {isEn ? "Owner admin only" : "Solo para owner admin"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "This technical wiki contains internal implementation metadata."
              : "Esta wiki técnica contiene metadatos internos de implementación."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="warning">
            <AlertTitle>
              {isEn ? "You do not have permission." : "No tienes permiso."}
            </AlertTitle>
            <AlertDescription>
              {roleError
                ? roleError
                : isEn
                  ? "Ask an owner admin to grant access if needed."
                  : "Solicita acceso a un owner admin si lo necesitas."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const snapshot = buildDocumentationSnapshot();

  const filteredRoutes = snapshot.routes.filter((route) =>
    hasQueryMatch(query, [
      route.method,
      route.path,
      route.handler,
      route.sourceFile,
      route.authHint,
      String(route.statusCode),
    ])
  );

  const filteredTables = snapshot.tables
    .map((table) => {
      const tableMatches = hasQueryMatch(query, [table.name]);
      if (!query || tableMatches) {
        return table;
      }

      const matchingColumns = table.columns.filter((column) =>
        hasQueryMatch(query, [column.name, column.type])
      );
      return {
        ...table,
        columns: matchingColumns,
      };
    })
    .filter((table) => {
      if (!query) return true;
      return hasQueryMatch(query, [table.name]) || table.columns.length > 0;
    });

  const filteredModules = snapshot.modules.filter((module) =>
    hasQueryMatch(query, [
      module.slug,
      module.label,
      module.labelEn,
      module.endpoint,
      module.description,
      module.descriptionEn,
    ])
  );

  const filteredWarnings = snapshot.warnings.filter((warning) =>
    hasQueryMatch(query, [warning.source, warning.message, warning.detail])
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Documentation" : "Documentación"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Auto-generated" : "Generación automática"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Codebase Wiki" : "Wiki del código"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Live technical reference generated from backend routers, SQL schema, and frontend module registry."
              : "Referencia técnica en vivo generada desde routers backend, esquema SQL y registro de módulos frontend."}
          </CardDescription>
          <p className="text-muted-foreground text-xs">
            {isEn ? "Generated at" : "Generado en"}:{" "}
            {formatGeneratedAt(snapshot.generatedAt, locale)}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-wrap items-center gap-2" method="get">
            <Input
              className="w-full md:max-w-md"
              defaultValue={asQuery(params.q)}
              name="q"
              placeholder={
                isEn
                  ? "Filter endpoints, tables, columns, modules..."
                  : "Filtrar endpoints, tablas, columnas, módulos..."
              }
            />
            <Button type="submit">{isEn ? "Search" : "Buscar"}</Button>
            {asQuery(params.q) ? (
              <Link
                className={cn(
                  buttonVariants({ size: "default", variant: "outline" })
                )}
                href="/documentation"
              >
                {isEn ? "Clear" : "Limpiar"}
              </Link>
            ) : null}
          </form>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <article className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {isEn ? "API endpoints" : "Endpoints API"}
              </p>
              <p className="mt-1 font-semibold text-2xl">
                {filteredRoutes.length}
              </p>
            </article>
            <article className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {isEn ? "DB tables" : "Tablas DB"}
              </p>
              <p className="mt-1 font-semibold text-2xl">
                {filteredTables.length}
              </p>
            </article>
            <article className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {isEn ? "Frontend modules" : "Módulos frontend"}
              </p>
              <p className="mt-1 font-semibold text-2xl">
                {filteredModules.length}
              </p>
            </article>
            <article className="rounded-2xl border border-border/70 bg-background/70 p-3">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                {isEn ? "Warnings" : "Advertencias"}
              </p>
              <p className="mt-1 font-semibold text-2xl">
                {filteredWarnings.length}
              </p>
            </article>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "API Endpoints" : "Endpoints API"}</CardTitle>
          <CardDescription>
            {isEn
              ? "Discovered from route handlers in the Rust backend."
              : "Descubiertos desde handlers de rutas en el backend Rust."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredRoutes.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isEn ? "No endpoints found." : "No se encontraron endpoints."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isEn ? "Method" : "Método"}</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>{isEn ? "Status" : "Estado"}</TableHead>
                  <TableHead>Auth</TableHead>
                  <TableHead>{isEn ? "Handler" : "Handler"}</TableHead>
                  <TableHead>
                    {isEn ? "Source file" : "Archivo fuente"}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRoutes.map((route) => (
                  <TableRow
                    key={`${route.method}-${route.path}-${route.sourceFile}-${route.handler}`}
                  >
                    <TableCell className="font-mono text-xs">
                      {route.method}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.path}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.statusCode}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.authHint}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.handler}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {route.sourceFile}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Database Tables" : "Tablas de base de datos"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Discovered from CREATE TABLE blocks in db/schema.sql."
              : "Descubiertas desde bloques CREATE TABLE en db/schema.sql."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredTables.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isEn ? "No tables found." : "No se encontraron tablas."}
            </p>
          ) : (
            <div className="grid gap-3">
              {filteredTables.map((table) => (
                <article
                  className="rounded-2xl border border-border/70 bg-background/65 p-3"
                  key={table.name}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-mono font-semibold text-sm">
                      {table.name}
                    </h3>
                    <Badge variant="secondary">
                      {table.columns.length} {isEn ? "columns" : "columnas"}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{isEn ? "Column" : "Columna"}</TableHead>
                          <TableHead>{isEn ? "Type" : "Tipo"}</TableHead>
                          <TableHead>{isEn ? "Nullable" : "Nulo"}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {table.columns.map((column) => (
                          <TableRow key={`${table.name}-${column.name}`}>
                            <TableCell className="font-mono text-xs">
                              {column.name}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {column.type}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {column.nullable
                                ? isEn
                                  ? "yes"
                                  : "sí"
                                : isEn
                                  ? "no"
                                  : "no"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Frontend Modules" : "Módulos frontend"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Discovered from apps/admin/lib/modules.ts."
              : "Descubiertos desde apps/admin/lib/modules.ts."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {filteredModules.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {isEn ? "No modules found." : "No se encontraron módulos."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isEn ? "Slug" : "Slug"}</TableHead>
                  <TableHead>{isEn ? "Label" : "Etiqueta"}</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>{isEn ? "Description" : "Descripción"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredModules.map((module) => (
                  <TableRow key={module.slug}>
                    <TableCell className="font-mono text-xs">
                      {module.slug}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEn ? module.labelEn : module.label}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {module.endpoint}
                    </TableCell>
                    <TableCell className="text-xs">
                      {isEn ? module.descriptionEn : module.description}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{isEn ? "Warnings" : "Advertencias"}</CardTitle>
          <CardDescription>
            {isEn
              ? "Non-fatal parser/runtime issues encountered during documentation generation."
              : "Problemas no fatales de parser/runtime detectados durante la generación."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {filteredWarnings.length === 0 ? (
            <Alert variant="success">
              <AlertTitle>
                {isEn ? "No warnings" : "Sin advertencias"}
              </AlertTitle>
              <AlertDescription>
                {isEn
                  ? "All configured documentation sources were parsed successfully."
                  : "Todas las fuentes configuradas se parsearon correctamente."}
              </AlertDescription>
            </Alert>
          ) : (
            filteredWarnings.map((warning) => (
              <Alert
                key={`${warning.source}-${warning.message}-${warning.detail ?? ""}`}
                variant="warning"
              >
                <AlertTitle className="font-mono text-xs uppercase">
                  {warning.source}
                </AlertTitle>
                <AlertDescription>
                  <p>{warning.message}</p>
                  {warning.detail ? (
                    <p className="mt-1 font-mono text-xs opacity-85">
                      {warning.detail}
                    </p>
                  ) : null}
                </AlertDescription>
              </Alert>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
