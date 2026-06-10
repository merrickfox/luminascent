#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_INPUT = join(__dirname, "raw-brands.txt");

function isSeparator(line) {
  const trimmed = line.trim();
  return trimmed.length > 0 && /^[/\-=_*#.\s]+$/.test(trimmed);
}

function isAllCaps(name) {
  return name === name.toUpperCase() && /[A-Z]/.test(name);
}

function preferBrand(existing, candidate) {
  const existingAllCaps = isAllCaps(existing);
  const candidateAllCaps = isAllCaps(candidate);
  if (existingAllCaps && !candidateAllCaps) return candidate;
  if (!existingAllCaps && candidateAllCaps) return existing;
  return existing;
}

function normalizeBrand(line) {
  let brand = line.trim();
  if (!brand || /^\d+$/.test(brand) || isSeparator(brand)) return null;

  const refineMatch = brand.match(/^\d+\s+Refine by Brand:\s*(.+)$/i);
  if (refineMatch) brand = refineMatch[1].trim();

  brand = brand.replace(/\s*\(\d+\)\s*$/, "").trim();

  return brand || null;
}

function dedupeAndSort(lines) {
  const seen = new Map();

  for (const line of lines) {
    const brand = normalizeBrand(line);
    if (!brand) continue;

    const key = brand.toLocaleLowerCase();
    const existing = seen.get(key);
    seen.set(key, existing ? preferBrand(existing, brand) : brand);
  }

  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "accent", numeric: true }),
  );
}

function main() {
  const inputPath = resolve(process.argv[2] ?? DEFAULT_INPUT);
  const outputPath = resolve(process.argv[3] ?? inputPath);

  const content = readFileSync(inputPath, "utf8");
  const lines = content.split(/\r?\n/);
  const originalCount = lines.filter((line) => normalizeBrand(line)).length;

  const brands = dedupeAndSort(lines);
  const output = `${brands.join("\n")}\n`;

  writeFileSync(outputPath, output, "utf8");

  console.log(
    `Deduplicated ${originalCount} entries -> ${brands.length} unique brands`,
  );
  console.log(`Wrote ${outputPath}`);
}

main();
