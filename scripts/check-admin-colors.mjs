#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const adminRoot = path.join(repoRoot, "apps", "admin");

const allowList = new Set(
  [
    "apps/admin/app/globals.css",
    "apps/admin/components/ui/alert.tsx",
    "apps/admin/components/ui/status-badge.tsx",
  ].map((entry) => path.join(repoRoot, entry))
);

const ignoreDirs = new Set([".git", ".next", "node_modules"]);
const allowedExtensions = new Set([".css", ".js", ".jsx", ".mdx", ".ts", ".tsx"]);

const forbiddenPaletteClassRegex =
  /\b(?:bg|text|border|ring|from|to|via|stroke|fill)-(?:emerald|amber|rose|sky|blue|violet|cyan|teal|lime|orange|yellow|fuchsia|indigo)-\d{2,3}(?:\/\d{1,3})?\b/g;
const forbiddenCustomNoticeRegex =
  /<(?:div|section|article)\b[^>]*\brole=["']alert["'][^>]*>/g;

async function collectFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (ignoreDirs.has(entry.name)) continue;
      files.push(...(await collectFiles(absolutePath)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (!allowedExtensions.has(path.extname(entry.name))) continue;
    files.push(absolutePath);
  }

  return files;
}

function findViolations(content) {
  const violations = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matches = line.match(forbiddenPaletteClassRegex);
    if (!matches) continue;
    for (const match of matches) {
      violations.push({ line: index + 1, token: match });
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matches = line.match(forbiddenCustomNoticeRegex);
    if (!matches) continue;
    violations.push({
      line: index + 1,
      token: "custom-notice-wrapper (use <Alert /> variant instead)",
    });
  }

  return violations;
}

async function main() {
  const files = await collectFiles(adminRoot);
  const failures = [];

  for (const filePath of files) {
    if (allowList.has(filePath)) continue;

    const content = await readFile(filePath, "utf8");
    const violations = findViolations(content);
    if (!violations.length) continue;

    failures.push({ filePath, violations });
  }

  if (!failures.length) {
    console.log("brand:check passed (no forbidden palette classes found)");
    return;
  }

  console.error("brand:check failed. Forbidden palette classes detected:\n");
  for (const failure of failures) {
    const relativePath = path.relative(repoRoot, failure.filePath);
    console.error(`- ${relativePath}`);
    for (const violation of failure.violations) {
      console.error(`  line ${violation.line}: ${violation.token}`);
    }
  }

  process.exitCode = 1;
}

main().catch((error) => {
  console.error("brand:check crashed:", error);
  process.exitCode = 1;
});
