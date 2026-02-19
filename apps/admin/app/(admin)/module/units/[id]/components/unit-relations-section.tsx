import { Suspense } from "react";

import { ModuleTableCard } from "@/components/shell/module-table-card";
import { fetchList } from "@/lib/api";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { getActiveOrgId } from "@/lib/org";

import { RelationDrawerCard } from "./relation-drawer-card";

async function RelatedListContent({
    slug,
    queryKey,
    queryValue,
    label,
}: {
    slug: string;
    queryKey: string;
    queryValue: string;
    label: string;
}) {
    const orgId = await getActiveOrgId();
    if (!orgId) return null;

    const moduleDef = MODULE_BY_SLUG.get(slug);
    if (!moduleDef) return null;

    try {
        const rows = (await fetchList(moduleDef.endpoint, orgId, 100, {
            [queryKey]: queryValue,
        })) as Record<string, unknown>[];

        return (
            <div className="mt-4 flex-1">
                <ModuleTableCard
                    moduleDescription={`Related to this unit`}
                    moduleLabel={label}
                    moduleSlug={slug}
                    rows={rows}
                />
            </div>
        );
    } catch (err) {
        return (
            <div className="mt-6 p-4 text-sm text-destructive bg-destructive/10 rounded-lg">
                Failed to load related records.
            </div>
        );
    }
}

export function UnitRelationsSection({
    links,
    isEn,
}: {
    links: Record<string, unknown>[];
    isEn: boolean;
}) {
    return (
        <div className="space-y-4">
            <h3 className="text-xl font-semibold text-foreground tracking-tight">
                {isEn ? "Related records" : "Registros relacionados"}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {links.map((linkStr, i) => {
                    const href = String(linkStr.href || "");
                    const label = String(linkStr.label || "");

                    const urlObj = new URL(href, "http://localhost");
                    let slug = urlObj.pathname.split("/").pop() || "";

                    if (slug === "operations" && urlObj.searchParams.get("tab")) {
                        slug = urlObj.searchParams.get("tab") as string;
                    }

                    let queryKey = "";
                    let queryValue = "";
                    for (const [k, v] of urlObj.searchParams.entries()) {
                        if (k !== "tab") {
                            queryKey = k;
                            queryValue = v;
                        }
                    }

                    if (!slug || !queryKey) {
                        return null; // Fallback
                    }

                    return (
                        <RelationDrawerCard
                            key={i}
                            label={label}
                            slug={slug}
                            isEn={isEn}
                        >
                            <Suspense
                                fallback={
                                    <div className="mt-8 flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
                                        {isEn ? "Loading..." : "Cargando..."}
                                    </div>
                                }
                            >
                                <RelatedListContent
                                    slug={slug}
                                    queryKey={queryKey}
                                    queryValue={queryValue}
                                    label={label}
                                />
                            </Suspense>
                        </RelationDrawerCard>
                    );
                })}
            </div>
        </div>
    );
}
