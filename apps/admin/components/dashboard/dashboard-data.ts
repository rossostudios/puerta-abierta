import { currentUser } from "@clerk/nextjs/server";

import {
  fetchList,
  fetchMe,
  fetchOperationsSummary,
  fetchOwnerSummary,
  type OperationsSummary,
} from "@/lib/api";

export async function safeList(
  path: string,
  orgId: string
): Promise<unknown[]> {
  try {
    return await fetchList(path, orgId, 25);
  } catch {
    return [];
  }
}

export async function safeReport(
  path: string,
  orgId: string
): Promise<Record<string, unknown>> {
  try {
    return await fetchOwnerSummary(path, orgId);
  } catch {
    return {};
  }
}

export async function safeOperationsSummary(
  orgId: string
): Promise<OperationsSummary> {
  try {
    return await fetchOperationsSummary(orgId);
  } catch {
    return {};
  }
}

export async function safeMe(): Promise<Record<string, unknown>> {
  try {
    return (await fetchMe()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function safeAuthUser(): Promise<Record<string, unknown>> {
  try {
    const user = await currentUser();
    return user ? (user as unknown as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
