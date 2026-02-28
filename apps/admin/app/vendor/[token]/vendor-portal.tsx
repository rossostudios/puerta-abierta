"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Job = {
  id: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  due_at?: string;
  property_name?: string;
  unit_name?: string;
  created_at?: string;
};

type JobDetail = Job & {
  items?: Array<{
    id: string;
    label: string;
    is_completed: boolean;
    sort_order: number;
  }>;
};

type Props = {
  token: string;
  vendorName: string;
  organizationId: string;
};

type StatusFilter = "all" | "pending" | "in_progress" | "done";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000/v1";

async function vendorFetch<T>(
  path: string,
  token: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-vendor-token": token,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/* -------------------------------------------------------------------------- */
/*  Stats card                                                                */
/* -------------------------------------------------------------------------- */
function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <p className={`font-bold text-2xl ${accent ?? ""}`}>{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter pill                                                               */
/* -------------------------------------------------------------------------- */
function FilterPill({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-medium text-xs transition-colors ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted"
      }`}
      onClick={onClick}
      type="button"
    >
      {label}
      <span
        className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 font-semibold text-[10px] ${
          active
            ? "bg-primary-foreground/20 text-primary-foreground"
            : "bg-muted text-muted-foreground"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Priority helpers                                                          */
/* -------------------------------------------------------------------------- */
function priorityVariant(p: string) {
  if (p === "urgent" || p === "critical") return "destructive" as const;
  if (p === "high") return "default" as const;
  return "secondary" as const;
}

function statusLabel(s: string) {
  if (s === "in_progress") return "In Progress";
  if (s === "done") return "Completed";
  if (s === "pending") return "Pending";
  return s;
}

function statusDot(s: string) {
  if (s === "done") return "bg-emerald-500";
  if (s === "in_progress") return "bg-amber-500";
  return "bg-gray-400";
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */
export function VendorPortal({ token, vendorName }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<JobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");

  // ---- Load jobs ----
  const loadJobs = useCallback(async () => {
    try {
      const res = await vendorFetch<{ data?: Job[] }>("/vendor/jobs", token);
      setJobs(res.data ?? []);
    } catch (err) {
      console.error("Failed to load jobs:", err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  // ---- Stats ----
  const stats = useMemo(() => {
    const total = jobs.length;
    const active = jobs.filter(
      (j) => j.status === "pending" || j.status === "in_progress"
    ).length;
    const done = jobs.filter((j) => j.status === "done").length;
    const completionRate = total > 0 ? ((done / total) * 100).toFixed(0) : "0";
    return { active, done, total, completionRate };
  }, [jobs]);

  // ---- Filtered jobs ----
  const filteredJobs = useMemo(() => {
    if (filter === "all") return jobs;
    return jobs.filter((j) => j.status === filter);
  }, [jobs, filter]);

  // ---- Filter counts ----
  const filterCounts = useMemo(
    () => ({
      all: jobs.length,
      pending: jobs.filter((j) => j.status === "pending").length,
      in_progress: jobs.filter((j) => j.status === "in_progress").length,
      done: jobs.filter((j) => j.status === "done").length,
    }),
    [jobs]
  );

  // ---- Toggle expansion & load detail ----
  const toggleExpand = useCallback(
    async (id: string) => {
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedDetail(null);
        return;
      }
      setExpandedId(id);
      setExpandedDetail(null);
      try {
        const detail = await vendorFetch<JobDetail>(
          `/vendor/jobs/${id}`,
          token
        );
        setExpandedDetail(detail);
      } catch (err) {
        console.error("Failed to load job detail:", err);
      }
    },
    [token, expandedId]
  );

  // ---- Accept job ----
  const handleAccept = useCallback(
    async (jobId: string) => {
      setActionLoading(jobId);
      try {
        await vendorFetch(`/vendor/jobs/${jobId}/accept`, token, {
          method: "POST",
        });
        setJobs((prev) =>
          prev.map((j) =>
            j.id === jobId ? { ...j, status: "in_progress" } : j
          )
        );
        if (expandedDetail?.id === jobId) {
          setExpandedDetail((prev) =>
            prev ? { ...prev, status: "in_progress" } : null
          );
        }
      } catch (err) {
        console.error("Failed to accept job:", err);
      } finally {
        setActionLoading(null);
      }
    },
    [token, expandedDetail]
  );

  // ---- Complete job ----
  const handleComplete = useCallback(
    async (jobId: string) => {
      setActionLoading(jobId);
      try {
        await vendorFetch(`/vendor/jobs/${jobId}/complete`, token, {
          method: "POST",
        });
        setJobs((prev) =>
          prev.map((j) => (j.id === jobId ? { ...j, status: "done" } : j))
        );
        if (expandedDetail?.id === jobId) {
          setExpandedDetail((prev) =>
            prev ? { ...prev, status: "done" } : null
          );
        }
      } catch (err) {
        console.error("Failed to complete job:", err);
      } finally {
        setActionLoading(null);
      }
    },
    [token, expandedDetail]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4">
      {/* ── Header ── */}
      <div>
        <h1 className="font-bold text-xl">Vendor Portal</h1>
        <p className="text-muted-foreground text-sm">Welcome, {vendorName}</p>
      </div>

      {/* ── Stats header ── */}
      {!loading && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Active Jobs" value={String(stats.active)} />
          <StatCard
            accent="text-emerald-600"
            label="Completion Rate"
            value={`${stats.completionRate}%`}
          />
          <StatCard
            accent="text-blue-600"
            label="Total Completed"
            value={String(stats.done)}
          />
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div className="py-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="mt-3 text-muted-foreground text-sm">Loading jobs...</p>
        </div>
      )}

      {/* ── Job list ── */}
      {!loading && (
        <div className="space-y-4">
          {/* Status filters */}
          <div className="flex flex-wrap gap-2">
            <FilterPill
              active={filter === "all"}
              count={filterCounts.all}
              label="All"
              onClick={() => setFilter("all")}
            />
            <FilterPill
              active={filter === "pending"}
              count={filterCounts.pending}
              label="Pending"
              onClick={() => setFilter("pending")}
            />
            <FilterPill
              active={filter === "in_progress"}
              count={filterCounts.in_progress}
              label="In Progress"
              onClick={() => setFilter("in_progress")}
            />
            <FilterPill
              active={filter === "done"}
              count={filterCounts.done}
              label="Completed"
              onClick={() => setFilter("done")}
            />
          </div>

          {/* Job count */}
          <h2 className="font-medium text-muted-foreground text-sm uppercase tracking-wide">
            {filter === "all" ? "All" : statusLabel(filter)} Jobs (
            {filteredJobs.length})
          </h2>

          {/* Empty state */}
          {filteredJobs.length === 0 && (
            <div className="rounded-xl border p-8 text-center">
              <p className="text-muted-foreground text-sm">
                {filter === "all"
                  ? "No jobs assigned at this time."
                  : `No ${statusLabel(filter).toLowerCase()} jobs.`}
              </p>
            </div>
          )}

          {/* Job cards */}
          {filteredJobs.map((job) => {
            const isExpanded = expandedId === job.id;
            const detail = isExpanded ? expandedDetail : null;
            const isActioning = actionLoading === job.id;

            return (
              <div
                className={`rounded-xl border transition-all ${
                  isExpanded ? "border-primary/40 shadow-sm" : ""
                }`}
                key={job.id}
              >
                {/* Job header (click to expand) */}
                <button
                  className="w-full p-4 text-left transition-colors hover:bg-muted/30"
                  onClick={() => toggleExpand(job.id)}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="font-semibold text-sm">{job.title}</span>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${statusDot(job.status)}`}
                          />
                          <span className="text-muted-foreground">
                            {statusLabel(job.status)}
                          </span>
                        </span>
                        {job.property_name && (
                          <span className="text-muted-foreground">
                            {job.property_name}
                          </span>
                        )}
                        {job.unit_name && (
                          <span className="text-muted-foreground">
                            {job.unit_name}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        className="text-[10px]"
                        variant={priorityVariant(job.priority)}
                      >
                        {job.priority}
                      </Badge>
                      <svg
                        className={`h-4 w-4 text-muted-foreground transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          d="M19 9l-7 7-7-7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                        />
                      </svg>
                    </div>
                  </div>
                </button>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t px-4 pt-3 pb-4">
                    {detail ? (
                      <div className="space-y-4">
                        {/* Description */}
                        {detail.description && (
                          <div>
                            <p className="mb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                              Description
                            </p>
                            <p className="text-sm leading-relaxed">
                              {detail.description}
                            </p>
                          </div>
                        )}

                        {/* Meta row */}
                        <div className="flex flex-wrap gap-4 text-sm">
                          <div>
                            <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                              Priority
                            </p>
                            <Badge
                              className="mt-1 text-[10px]"
                              variant={priorityVariant(detail.priority)}
                            >
                              {detail.priority}
                            </Badge>
                          </div>
                          {detail.due_at && (
                            <div>
                              <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                                Due Date
                              </p>
                              <p className="mt-1 text-sm">
                                {new Date(detail.due_at).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                          {detail.created_at && (
                            <div>
                              <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                                Created
                              </p>
                              <p className="mt-1 text-sm">
                                {new Date(
                                  detail.created_at
                                ).toLocaleDateString()}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* Checklist */}
                        {detail.items && detail.items.length > 0 && (
                          <div className="space-y-2">
                            <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
                              Checklist (
                              {
                                detail.items.filter((i) => i.is_completed)
                                  .length
                              }
                              /{detail.items.length})
                            </p>
                            {detail.items
                              .sort((a, b) => a.sort_order - b.sort_order)
                              .map((item) => (
                                <div
                                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                                  key={item.id}
                                >
                                  <input
                                    checked={item.is_completed}
                                    className="rounded"
                                    readOnly
                                    type="checkbox"
                                  />
                                  <span
                                    className={`text-sm ${
                                      item.is_completed
                                        ? "text-muted-foreground line-through"
                                        : ""
                                    }`}
                                  >
                                    {item.label}
                                  </span>
                                </div>
                              ))}
                          </div>
                        )}

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 pt-1">
                          {detail.status === "pending" && (
                            <Button
                              disabled={isActioning}
                              onClick={() => handleAccept(detail.id)}
                              size="sm"
                            >
                              {isActioning ? "Accepting..." : "Accept Job"}
                            </Button>
                          )}
                          {detail.status === "in_progress" && (
                            <Button
                              disabled={isActioning}
                              onClick={() => handleComplete(detail.id)}
                              size="sm"
                            >
                              {isActioning ? "Completing..." : "Mark Complete"}
                            </Button>
                          )}
                          {detail.status === "done" && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-700 text-xs dark:bg-emerald-950 dark:text-emerald-400">
                              <svg
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  d="M5 13l4 4L19 7"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                />
                              </svg>
                              Completed
                            </span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="animate-pulse py-4 text-center text-muted-foreground text-sm">
                        Loading details...
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
