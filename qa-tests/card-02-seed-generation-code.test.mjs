#!/usr/bin/env node
// Card: "⚠️ Placeholder generation_code bug ฝังอยู่ใน seed file ต้นทาง"
// Unit tests for the generation_code computation logic in
// scripts/fix-seed-generation-codes.mjs, per the card's own test spec:
//   - year_start/year_end range -> "2018-2023"
//   - is_current=true -> "2020-ปัจจุบัน"
//   - year_end null (approx unknown) -> no case in spec draft, but real data has it
//   - year_start == year_end (single year) -> not present in this dataset (see note)
//   - no case should fall back to the old placeholder text
// Run: node qa-tests/card-02-seed-generation-code.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSeedText } from "../scripts/fix-seed-generation-codes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(__dirname, "..", "db", "seed_from_v7_adjusted.sql");
const PLACEHOLDER = "รุ่นเดียว (ไม่มีการแยกเจนเนอเรชันเพิ่มเติม)";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  FAIL - ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

// --- 1) Logic-level cases (synthetic, mirrors card's draft test matrix) ---
console.log("generation_code formula:");

check("normal range: year_start=2018, year_end=2023 -> '2018-2023'", () => {
  const line =
    "insert into model_generations (generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note) overriding system value values (9001, 1, '" +
    PLACEHOLDER +
    "', 2018, false, 2023, false, false, '');";
  const { text } = transformSeedText(line);
  assert.match(text, /'2018-2023'/);
});

check("is_current=true, year_start=2020 -> '2020-ปัจจุบัน'", () => {
  const line =
    "insert into model_generations (generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note) overriding system value values (9002, 1, '" +
    PLACEHOLDER +
    "', 2020, false, null, false, true, '');";
  const { text } = transformSeedText(line);
  assert.match(text, /'2020-ปัจจุบัน'/);
});

check("year_end null + year_end_approx=true, not current -> '{year_start}-ไม่ทราบปี'", () => {
  const line =
    "insert into model_generations (generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note) overriding system value values (9003, 1, '" +
    PLACEHOLDER +
    "', 1996, false, null, true, false, '');";
  const { text } = transformSeedText(line);
  assert.match(text, /'1996-ไม่ทราบปี'/);
});

check("generation_id 151 documented manual override -> 'รุ่นธรรมดา' (not year formula)", () => {
  const line =
    "insert into model_generations (generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note) overriding system value values (151, 115, '" +
    PLACEHOLDER +
    "', 2019, false, null, false, true, '');";
  const { text } = transformSeedText(line);
  assert.match(text, /'รุ่นธรรมดา'/);
});

check("note field with doubled-quote escaping ('' -> ') is preserved untouched", () => {
  const line =
    "insert into model_generations (generation_id, model_id, generation_code, year_start, year_start_approx, year_end, year_end_approx, is_current, note) overriding system value values (327, 247, '" +
    PLACEHOLDER +
    "', 1996, false, 1999, false, false, '''Toyopet Tiara'' เป็นชื่อทำตลาดของ Corona ในไทย');";
  const { text, fixedCount } = transformSeedText(line);
  assert.equal(fixedCount, 1);
  assert.match(text, /'1996-1999'/);
  assert.match(text, /'''Toyopet Tiara'' เป็นชื่อทำตลาดของ Corona ในไทย'/);
});

check("year_start == year_end (single year) is not present in this dataset — documenting as untested edge case", () => {
  // No row in db/seed_from_v7_adjusted.sql has year_start === year_end among the
  // placeholder rows (verified against live staging DB on 2026-07-18). The formula
  // (`${year_start}-${year_end}`) would render e.g. "2020-2020" for this case, which
  // was not spec'd by the card and has no live example to validate against — flagged
  // here rather than silently assumed correct.
  assert.ok(true);
});

// --- 2) File-level verification (per card's "Verification หลังแก้ไฟล์" section) ---
console.log("\nfile-level verification:");

check(`grep -c "${PLACEHOLDER}" db/seed_from_v7_adjusted.sql === 0`, () => {
  const text = readFileSync(SEED_PATH, "utf8");
  const count = text.split(PLACEHOLDER).length - 1;
  assert.equal(count, 0);
});

check("re-running the transform on the already-fixed file is a no-op (idempotent / no leftover placeholders)", () => {
  const text = readFileSync(SEED_PATH, "utf8");
  const { placeholderCount, fixedCount } = transformSeedText(text);
  assert.equal(placeholderCount, 0);
  assert.equal(fixedCount, 0);
});

console.log(`\n${passed} check(s) passed.`);
