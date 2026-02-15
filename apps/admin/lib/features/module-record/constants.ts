export const TASK_CLOSED_STATUSES = new Set([
  "done",
  "completed",
  "cancelled",
  "canceled",
  "resolved",
  "closed",
]);

export const LEASE_ACTIVE_STATUSES = new Set(["active", "delinquent"]);

export const ACTIVE_RESERVATION_STATUSES = new Set([
  "pending",
  "confirmed",
  "checked_in",
]);

export const APPLICATION_CLOSED_STATUSES = new Set([
  "rejected",
  "lost",
  "contract_signed",
]);

export const COLLECTION_OPEN_STATUSES = new Set([
  "scheduled",
  "pending",
  "late",
  "overdue",
  "partial",
]);

export const COLLECTION_PAID_STATUSES = new Set([
  "paid",
  "completed",
  "settled",
]);

export const URGENT_TASK_PRIORITIES = new Set(["high", "critical", "urgent"]);
