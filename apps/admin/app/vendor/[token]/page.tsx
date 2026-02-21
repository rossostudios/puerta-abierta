import { fetchPublicJson } from "@/lib/api";

import { VendorPortal } from "./vendor-portal";

type PageProps = {
  params: Promise<{ token: string }>;
};

type VerifyResponse = {
  authenticated?: boolean;
  organization_id?: string;
  vendor_name?: string;
};

export default async function VendorPage({ params }: PageProps) {
  const { token } = await params;

  let auth: VerifyResponse | null = null;
  let error: string | null = null;

  try {
    auth = await fetchPublicJson<VerifyResponse>("/public/vendor/verify", undefined, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      cache: "no-store",
    });
  } catch (err) {
    error = err instanceof Error ? err.message : "Invalid or expired link.";
  }

  if (!auth?.authenticated || !auth.organization_id) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="rounded-xl border p-8 max-w-md w-full text-center space-y-3">
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            {error || "This link is invalid or has expired. Please contact your property manager for a new access link."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <VendorPortal
        token={token}
        vendorName={auth.vendor_name ?? "Vendor"}
        organizationId={auth.organization_id}
      />
    </div>
  );
}
