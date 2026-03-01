import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveLocale } from "@/lib/i18n/server";
import { NoOrgCard } from "@/lib/page-helpers";
import { getActiveOrgId } from "@/lib/org";

import { NotificationsManager } from "./notifications-manager";

type PageProps = {
  searchParams: Promise<{
    status?: string;
    category?: string;
  }>;
};

export default async function NotificationsPage({ searchParams }: PageProps) {
  const locale = await getActiveLocale();
  const isEn = locale === "en-US";
  const orgId = await getActiveOrgId();
  const sp = await searchParams;

  if (!orgId) {
    return (
      <NoOrgCard
        isEn={isEn}
        resource={["notifications", "las notificaciones"]}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {isEn ? "Communications" : "Comunicaciones"}
            </Badge>
            <Badge variant="secondary">
              {isEn ? "Notifications" : "Notificaciones"}
            </Badge>
          </div>
          <CardTitle className="text-2xl">
            {isEn ? "Notification Center" : "Centro de Notificaciones"}
          </CardTitle>
          <CardDescription>
            {isEn
              ? "Track in-app events, unread state, and activity history."
              : "Consulta eventos internos, estado de lectura e historial de actividad."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationsManager
            initialCategory={sp.category}
            initialStatus={sp.status}
            locale={locale}
            orgId={orgId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
