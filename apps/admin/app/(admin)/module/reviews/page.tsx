import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fetchJson, getApiBaseUrl } from "@/lib/api";
import { errorMessage, isOrgMembershipError } from "@/lib/errors";
import { getActiveLocale } from "@/lib/i18n/server";
import { getActiveOrgId } from "@/lib/org";

import { ReviewsManager } from "./reviews-manager";

type PageProps = {
  searchParams: Promise<Record<string, string>>;
};

type ReviewRow = {
  id: string;
  guest_name?: string | null;
  platform: string;
  rating?: number | null;
  review_text?: string | null;
  response_text?: string | null;
  response_status: string;
  ai_suggested_response?: string | null;
  responded_at?: string | null;
  review_date?: string | null;
  property_name?: string | null;
  created_at?: string | null;
};

export default async function ReviewsPage({}: PageProps) {
  const locale = await getActiveLocale();
  const orgId = await getActiveOrgId();
  const isEn = locale === "en-US";

  if (!orgId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "Organization required" : "Organización requerida"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isEn
              ? "Select an organization from the sidebar."
              : "Seleccione una organización del menú lateral."}
          </p>
        </CardContent>
      </Card>
    );
  }

  let reviews: ReviewRow[] = [];
  try {
    const res = await fetchJson<{ data?: ReviewRow[] }>("/reviews", {
      org_id: orgId,
      response_status: "pending",
      limit: 50,
    });
    reviews = res.data ?? [];
  } catch (err) {
    const message = errorMessage(err);
    if (isOrgMembershipError(message)) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>{isEn ? "Access denied" : "Acceso denegado"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{message}</p>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            {isEn ? "API connection failed" : "Fallo de conexión a la API"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{message}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {getApiBaseUrl()}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEn ? "Guest Reviews" : "Reseñas de Huéspedes"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Manage reviews and publish AI-suggested responses."
              : "Gestiona reseñas y publica respuestas sugeridas por IA."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReviewsManager
            orgId={orgId}
            initialReviews={reviews}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
