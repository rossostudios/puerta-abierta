import { getApiBaseUrl } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { MODULE_BY_SLUG } from "@/lib/modules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildRelatedLinks } from "./related-links";
import { recordTitle, sortKeys } from "./utils";

type LoadRecordDetailResult =
    | { kind: "not_found" }
    | {
        kind: "error";
        baseUrl: string;
        message: string;
        membershipError: boolean;
        requestStatus: number | null;
    }
    | {
        kind: "success";
        data: {
            record: Record<string, unknown>;
            recordId: string;
            title: string;
            keys: string[];
            relatedLinks: Record<string, unknown>[];
        };
        baseUrl: string;
    };

export async function loadRecordDetailData({
    slug,
    id,
    locale,
}: {
    slug: string;
    id: string;
    locale: "en-US" | "es-PY";
}): Promise<LoadRecordDetailResult> {
    const isEn = locale === "en-US";
    const moduleDef = MODULE_BY_SLUG.get(slug);

    if (!moduleDef || moduleDef.kind === "report") {
        return { kind: "not_found" };
    }

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}${moduleDef.endpoint}/${encodeURIComponent(id)}`;

    let record: Record<string, unknown> | null = null;
    let apiError: string | null = null;
    let requestStatus: number | null = null;
    let is404 = false;

    try {
        const supabase = await createSupabaseServerClient();
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;

        const response = await fetch(url, {
            cache: "no-store",
            headers: {
                Accept: "application/json",
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
        });
        is404 = response.status === 404;

        if (!is404 && response.ok) {
            record = (await response.json()) as Record<string, unknown>;
        } else if (!is404) {
            const details = await response.text().catch(() => "");
            const suffix = details ? `: ${details.slice(0, 240)}` : "";
            requestStatus = response.status;
            apiError = `HTTP ${response.status} for ${moduleDef.endpoint}${suffix}`;
        }
    } catch (err) {
        if (err instanceof Error && err.message === "NEXT_REDIRECT") {
            throw err;
        }
        if (err instanceof Error && err.name === "NotFoundError") {
            throw err;
        }
        apiError = errorMessage(err);
    }

    if (is404) {
        return { kind: "not_found" };
    }

    if (apiError || !record) {
        const isMembershipError =
            requestStatus === 403 &&
            apiError !== null &&
            apiError.includes("Not a member of organization");

        return {
            kind: "error",
            baseUrl,
            message: apiError ?? "Unknown error",
            membershipError: isMembershipError,
            requestStatus,
        };
    }

    const title = recordTitle(
        record,
        isEn ? "Record details" : "Detalles del registro"
    );
    const recordId = typeof record.id === "string" ? record.id : id;

    const relatedLinks = buildRelatedLinks(moduleDef.slug, recordId, isEn);

    const keys = sortKeys(Object.keys(record)).filter((key) => {
        if (moduleDef.slug !== "owner-statements") return true;
        return key !== "line_items" && key !== "reconciliation";
    });

    return {
        kind: "success",
        baseUrl,
        data: {
            record,
            title,
            recordId,
            keys,
            relatedLinks,
        },
    };
}
