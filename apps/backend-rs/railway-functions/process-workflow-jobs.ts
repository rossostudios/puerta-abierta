const baseUrlInput = (
  process.env.WORKFLOW_TARGET_BASE_URL ??
  process.env.BACKEND_BASE_URL ??
  process.env.RAILWAY_SERVICE_PUERTA_ABIERTA_URL ??
  ""
).trim();

if (!baseUrlInput) {
  throw new Error(
    "Missing WORKFLOW_TARGET_BASE_URL, BACKEND_BASE_URL, or RAILWAY_SERVICE_PUERTA_ABIERTA_URL."
  );
}

const baseUrl = baseUrlInput.startsWith("http")
  ? baseUrlInput
  : `https://${baseUrlInput}`;

const apiKey = (process.env.INTERNAL_API_KEY ?? "").trim();
const limitRaw = Number(process.env.WORKFLOW_PROCESS_LIMIT ?? "100");
const limit = Number.isFinite(limitRaw)
  ? Math.min(500, Math.max(1, Math.trunc(limitRaw)))
  : 100;

const endpoint = `${baseUrl.replace(/\/$/, "")}/v1/internal/process-workflow-jobs?limit=${limit}`;

const headers: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};
if (apiKey) {
  headers["x-api-key"] = apiKey;
}

const response = await fetch(endpoint, {
  method: "POST",
  headers,
});

const text = await response.text();
if (!response.ok) {
  throw new Error(`process-workflow-jobs failed (${response.status}): ${text}`);
}

console.log(
  JSON.stringify({
    job: "process-workflow-jobs",
    status: response.status,
    response: text || "{}",
  })
);
