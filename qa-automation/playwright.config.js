import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const STAGING_BASE_URL = process.env.STAGING_BASE_URL;

if (!STAGING_BASE_URL) {
  // ไม่ throw ตรงนี้เพราะบางคำสั่ง (เช่น --list) ไม่จำเป็นต้องมี env จริง
  console.warn(
    "[playwright.config] ⚠️  STAGING_BASE_URL ยังไม่ถูกตั้งค่า — คัดลอก .env.example เป็น .env แล้วกรอกค่าก่อนรันจริง"
  );
}

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // เปิด parallel แล้ว (22 ก.ค. 2026) — เดิมปิดไว้เพราะทุก test แชร์ shop/staff account เดียวกัน
  // ตอนนี้แก้แล้วด้วย multi-shop: fixtures/test-data.js resolve credential ตาม
  // process.env.TEST_PARALLEL_INDEX (Playwright set ให้อัตโนมัติต่อ worker) แต่ละ worker
  // จึงได้ shop ของตัวเอง 1 ใน 5 ชุด ไม่ชน state กันอีกต่อไป (ดู scripts/setup-test-data.mjs
  // -> setupWorkerShop สำหรับที่มาของ 5 shop นี้)
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: 5,
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/results.json" }],
    ["html", { outputFolder: "test-results/html-report", open: "never" }],
  ],
  use: {
    baseURL: STAGING_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
