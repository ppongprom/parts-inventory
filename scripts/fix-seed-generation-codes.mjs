#!/usr/bin/env node
// Card: "⚠️ Placeholder generation_code bug ฝังอยู่ใน seed file ต้นทาง"
//
// Replaces the placeholder string "รุ่นเดียว (ไม่มีการแยกเจนเนอเรชันเพิ่มเติม)" in
// db/seed_from_v7_adjusted.sql with a real generation_code computed from
// year_start/year_end/is_current, using the same logic as the bulk-fix script that
// was previously run directly against Supabase (staging/beta) at runtime only.
//
// Formula (reverse-engineered + verified against 254/254 live rows on staging via
// Supabase MCP execute_sql on 2026-07-18):
//   1) is_current === true                          -> `${year_start}-ปัจจุบัน`
//   2) year_end is not null                          -> `${year_start}-${year_end}`
//   3) year_end is null AND year_end_approx is true  -> `${year_start}-ไม่ทราบปี`
//   4) generation_id 151 is a documented one-off manual rename on staging
//      ("รุ่นธรรมดา") that doesn't fit the year-based formula — hardcoded to match
//      the live source of truth so the seed produces 0 remaining placeholders.
//
// Usage: node scripts/fix-seed-generation-codes.mjs [--dry-run]

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "..", "db", "seed_from_v7_adjusted.sql");
const PLACEHOLDER = "รุ่นเดียว (ไม่มีการแยกเจนเนอเรชันเพิ่มเติม)";

const MANUAL_OVERRIDES = {
  151: "รุ่นธรรมดา",
};

// Note: SQL string literals here escape embedded quotes by doubling them ('' -> '),
// not with backslashes (e.g. note = '''Toyopet Tiara'' เป็นชื่อ...').
const LINE_RE =
  /^insert into model_generations \(generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note\) overriding system value values \((\d+), (\d+), '((?:[^']|'')*)', (\d+), (true|false), (null|\d+), (true|false), (true|false), '((?:[^']|'')*)'\);$/;

function computeGenerationCode({ generationId, yearStart, yearEnd, yearEndApprox, isCurrent }) {
  if (MANUAL_OVERRIDES[generationId] !== undefined) return MANUAL_OVERRIDES[generationId];
  if (isCurrent) return `${yearStart}-ปัจจุบัน`;
  if (yearEnd !== null) return `${yearStart}-${yearEnd}`;
  if (yearEndApprox) return `${yearStart}-ไม่ทราบปี`;
  throw new Error(`generation_id ${generationId}: cannot determine generation_code (no year_end, not current, not approx)`);
}

export function transformSeedText(text) {
  let placeholderCount = 0;
  let fixedCount = 0;
  const lines = text.split("\n").map((line) => {
    if (!line.includes(PLACEHOLDER)) return line;
    const m = line.match(LINE_RE);
    if (!m) return line; // leave untouched if shape doesn't match (defensive)
    placeholderCount++;
    const [, generationIdStr, , code, yearStartStr, , yearEndStr, yearEndApproxStr, isCurrentStr] = m;
    if (code !== PLACEHOLDER) return line;

    const generationId = Number(generationIdStr);
    const yearStart = Number(yearStartStr);
    const yearEnd = yearEndStr === "null" ? null : Number(yearEndStr);
    const yearEndApprox = yearEndApproxStr === "true";
    const isCurrent = isCurrentStr === "true";

    const newCode = computeGenerationCode({ generationId, yearStart, yearEnd, yearEndApprox, isCurrent });
    fixedCount++;
    return line.replace(`'${PLACEHOLDER}'`, `'${newCode.replace(/'/g, "''")}'`);
  });
  return { text: lines.join("\n"), placeholderCount, fixedCount };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const original = readFileSync(SEED_PATH, "utf8");
  const { text, placeholderCount, fixedCount } = transformSeedText(original);

  console.log(`Found ${placeholderCount} placeholder rows, fixed ${fixedCount}.`);
  if (placeholderCount !== fixedCount) {
    console.error("Mismatch — not all placeholder rows could be parsed/fixed. Aborting.");
    process.exit(1);
  }
  if (dryRun) {
    console.log("Dry run — not writing file.");
    return;
  }
  writeFileSync(SEED_PATH, text, "utf8");
  console.log(`Wrote ${SEED_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
