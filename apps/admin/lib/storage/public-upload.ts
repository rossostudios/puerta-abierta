"use client";

import { authedFetch } from "@/lib/api-client";

export type PublicStorageNamespace = "documents" | "receipts" | "listings";

type PresignUploadResponse = {
  method: "PUT";
  upload_url: string;
  public_url: string;
  object_key: string;
  expires_in_seconds: number;
  required_headers?: Record<string, string>;
};

export function safeStorageFileName(name: string): string {
  return name.replaceAll(/[^\w.-]+/g, "-");
}

export async function uploadPublicFileViaApi(input: {
  namespace: PublicStorageNamespace;
  key: string;
  file: File;
  orgId?: string | null;
}): Promise<{ publicUrl: string; objectKey: string }> {
  const presigned = await authedFetch<PresignUploadResponse>(
    "/storage/presign-upload",
    {
      method: "POST",
      body: JSON.stringify({
        namespace: input.namespace,
        key: input.key,
        org_id: input.orgId ?? undefined,
        content_type: input.file.type || undefined,
      }),
    }
  );

  const headers = new Headers();
  if (presigned.required_headers) {
    for (const [key, value] of Object.entries(presigned.required_headers)) {
      headers.set(key, value);
    }
  } else if (input.file.type) {
    headers.set("content-type", input.file.type);
  }

  const uploadResponse = await fetch(presigned.upload_url, {
    method: "PUT",
    headers,
    body: input.file,
  });

  if (!uploadResponse.ok) {
    let detail = `Upload failed (${uploadResponse.status})`;
    try {
      const body = await uploadResponse.text();
      if (body.trim()) detail = `${detail}: ${body.trim()}`;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  return {
    publicUrl: presigned.public_url,
    objectKey: presigned.object_key,
  };
}
