import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<{ new?: string; agent?: string }>;
};

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

export default async function AgentCompatPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const qs = new URLSearchParams();

  if (isTruthy(params.new)) {
    qs.set("new", "1");
  }

  if (typeof params.agent === "string" && params.agent.trim()) {
    qs.set("agent", params.agent.trim());
  }

  redirect(`/app/agents${qs.size ? `?${qs.toString()}` : ""}`);
}
