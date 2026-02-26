import { getApiBaseUrl } from "@/lib/api";
import { getServerAccessToken } from "@/lib/auth/server-access-token";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import type { Locale } from "@/lib/i18n";
import {
  asString,
  getFirstValue,
  isPropertyRecordId as isPropertyRecordIdImpl,
  parseBackendErrorText,
  recordTitle,
  sortKeys,
} from "./data-helpers";
import { buildPropertyOverview } from "./data-overview";
import { buildRelatedLinks } from "./data-related-links";
import { loadPropertyRelationSnapshot } from "./data-snapshot";
import type { PropertyDetailLoadResult, PropertyDetailPageData } from "./types";

export async function loadPropertyDetailData(params: {
  id: string;
  locale: Locale;
}): Promise<PropertyDetailLoadResult> {
  const { id, locale } = params;
  const baseUrl = getApiBaseUrl();
  const isEn = locale === "en-US";
  const recordUrl = `${baseUrl}/properties/${encodeURIComponent(id)}`;

  let accessToken: string | null = null;
  try {
    accessToken = await getServerAccessToken();
  } catch {
    accessToken = null;
  }

  let record: Record<string, unknown> | null = null;
  let requestStatus: number | null = null;

  try {
    const response = await fetch(recordUrl, {
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    if (response.status === 404) {
      return { kind: "not_found" };
    }

    if (!response.ok) {
      const details = await response.text().catch(() => "");
      const detailMessage = parseBackendErrorText(details);
      const suffix = detailMessage ? `: ${detailMessage.slice(0, 240)}` : "";
      requestStatus = response.status;
      const message = `HTTP ${response.status} for /properties${suffix}`;
      return {
        kind: "error",
        baseUrl,
        membershipError:
          response.status === 403 &&
          isOrgMembershipError(detailMessage || message),
        message,
        requestStatus,
        orgId: null,
      };
    }

    record = (await response.json()) as Record<string, unknown>;
  } catch (err) {
    return {
      kind: "error",
      baseUrl,
      membershipError: false,
      message: errorMessage(err),
      requestStatus,
      orgId: null,
    };
  }

  if (!record) {
    return {
      kind: "error",
      baseUrl,
      membershipError: false,
      message: isEn
        ? "Could not load property record."
        : "No se pudo cargar la propiedad.",
      requestStatus,
      orgId: null,
    };
  }

  const recordId = asString(record.id) || id;
  const orgId = asString(record.organization_id) || null;
  const snapshot = orgId
    ? await loadPropertyRelationSnapshot({
        accessToken,
        baseUrl,
        orgId,
        propertyId: recordId,
      })
    : null;

  const title = recordTitle(
    record,
    isEn ? "Property details" : "Detalles de propiedad"
  );

  const propertyCodeLabel = getFirstValue(record, [
    "code",
    "public_name",
    "id",
  ]);
  const propertyLocationLabel = [
    getFirstValue(record, ["district", "neighborhood", "city"]),
    getFirstValue(record, ["address", "street_address", "location"]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(" · ");

  const data: PropertyDetailPageData = {
    record,
    recordId,
    title,
    propertyCodeLabel,
    propertyLocationLabel,
    overview: snapshot
      ? buildPropertyOverview({ snapshot, locale, recordId })
      : null,
    keys: sortKeys(Object.keys(record)),
    relatedLinks: buildRelatedLinks({ recordId, isEn }),
  };

  return { kind: "success", data };
}

export function isPropertyRecordId(value: string): boolean {
  return isPropertyRecordIdImpl(value);
}
