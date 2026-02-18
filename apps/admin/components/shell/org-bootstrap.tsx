"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

type OrgBootstrapProps = {
  activeOrgId: string | null;
};

export function OrgBootstrap({ activeOrgId }: OrgBootstrapProps) {
  const router = useRouter();
  const bootstrappedRef = useRef(false);

  const { data: organizations } = useQuery({
    queryKey: ["me-organizations-bootstrap"],
    queryFn: async () => {
      const response = await fetch("/api/me", { cache: "no-store" });
      if (!response.ok) return [];
      const payload = (await response.json()) as {
        organizations?: Array<{ id: string }>;
      };
      return payload.organizations ?? [];
    },
  });

  const { mutate: runBootstrap } = useMutation({
    mutationFn: async ({
      orgs,
      currentOrgId,
    }: {
      orgs: Array<{ id: string }>;
      currentOrgId: string | null;
    }) => {
      if (!orgs.length) {
        if (currentOrgId) {
          await fetch("/api/org", {
            method: "DELETE",
            headers: { Accept: "application/json" },
          });
        }
        return true;
      }

      const hasActive = currentOrgId
        ? orgs.some((org) => org.id === currentOrgId)
        : false;
      if (hasActive) return false;

      const first = orgs[0]?.id;
      if (!first) return false;

      await fetch("/api/org", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ org_id: first }),
      });

      return true;
    },
    onSuccess: (shouldRefresh) => {
      if (shouldRefresh) router.refresh();
    },
  });

  useEffect(() => {
    if (!organizations || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    runBootstrap({ orgs: organizations, currentOrgId: activeOrgId });
  }, [organizations, activeOrgId, runBootstrap]);

  return null;
}
