// การ์ด "middleware.js — defense-in-depth route protection (เพิ่มใหม่ 24 ก.ค. 2026)"
//
// ดู middleware.js (root ของ repo) สำหรับ context เต็ม: เดิมแอปนี้ไม่มี Next.js middleware เลย
// การป้องกันเส้นทางทั้งหมดอยู่ที่ components/RequireAuth.js (client component) ชั้นเดียว —
// ตัวนี้ทดสอบชั้น middleware ใหม่โดยเฉพาะ (แยกจาก rbac.spec.js ที่ทดสอบ RequireAuth.js/role
// authorization ซึ่งยังทำงานเหมือนเดิมทุกประการ ไม่ได้ถูกแทนที่)
//
// 3 กลุ่ม:
//   1. Protected route ไม่มี session -> ต้องเจอ redirect ที่ระดับ HTTP เอง (ก่อน JS bundle ใดๆ
//      รันด้วยซ้ำ) ไม่ใช่แค่ client-side fallback ของ RequireAuth.js
//   2. Public route (login/staff-login/signup/reset-password/share-link ลูกค้า) ต้องเข้าได้ปกติ
//      โดยไม่มี session เลย — ต้องไม่ถูก middleware เผลอ gate (นี่คือความเสี่ยงจริงที่สุดของงานนี้)
//   3. ผู้ใช้ที่ login ปกติ ต้องไม่ถูก middleware เผลอบล็อก (regression check ระดับ smoke)

import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { accounts } from "../fixtures/test-data.js";

const PROTECTED_PATHS = ["/", "/jobs", "/admin", "/add"];

test.describe("Middleware — ไม่มี session เลย ต้องถูก redirect ไป /login ที่ระดับ HTTP", () => {
  for (const path of PROTECTED_PATHS) {
    test(`GET ${path} แบบไม่มี cookie เลย ต้องได้ 307 redirect ตรงจาก server ไป /login (ไม่ใช่แค่ client fallback)`, async ({
      page,
    }) => {
      // maxRedirects: 0 ปิดการ auto-follow ของ Playwright APIRequestContext — เอาไว้ตรวจ raw
      // HTTP response ตรงๆ ว่า server (middleware) เป็นคนสั่ง redirect จริง ไม่ใช่ HTML ที่ client
      // JS ค่อยสั่ง navigate เอง (ถ้าเป็นแบบหลัง status จะเป็น 200 ไม่ใช่ 307/302)
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect([307, 308, 302, 303]).toContain(res.status());
      const location = res.headers()["location"] || "";
      expect(location).toContain("/login");
    });

    test(`page.goto(${path}) แบบไม่มี session สุดท้าย landing ที่ /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    });
  }
});

test.describe("Middleware — public route ต้องเข้าได้ปกติโดยไม่มี session", () => {
  const PUBLIC_PATHS = ["/login", "/staff-login", "/signup", "/reset-password"];

  for (const path of PUBLIC_PATHS) {
    test(`GET ${path} แบบไม่มี cookie ต้องได้ 200 ตรงๆ ไม่ถูก redirect`, async ({ page }) => {
      const res = await page.request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(200);
    });
  }

  // เส้นทางลูกค้าดูสถานะงานผ่าน token (app/share/customer/[token]/page.js) — ไม่ใช้ Supabase Auth
  // session เลย ต้องไม่ถูก middleware เผลอ gate หลังบรรทัดนี้ — ใช้ token ปลอมก็พอ (แค่ต้องการ
  // ยืนยันว่า "ไม่ถูกเด้งไป /login" ไม่ได้ต้องการยืนยันเนื้อหาจริงของ token ที่ valid)
  test("GET /share/customer/[token ปลอม] ต้องได้ 200 ไม่ถูก redirect ไป /login (token-based, ไม่ใช่ session-based)", async ({
    page,
  }) => {
    const res = await page.request.get("/share/customer/00000000-0000-0000-0000-000000000000", {
      maxRedirects: 0,
    });
    expect(res.status()).toBe(200);
  });

  test("page.goto(/share/customer/[token ปลอม]) render หน้า error ของ token ปกติ ไม่เด้งไป /login", async ({
    page,
  }) => {
    await page.goto("/share/customer/00000000-0000-0000-0000-000000000000");
    await expect(page).not.toHaveURL(/\/login/);
    // หน้า page.js เรียก /api/public/customer/[token] แล้วโชว์ .msg.error ถ้า token ไม่ถูกต้อง
    await expect(page.locator(".msg.error")).toBeVisible({ timeout: 10_000 });
  });

  test("/api/public/customer/[token ปลอม] เองก็ต้องไม่ถูก middleware แตะ (คืน JSON error ไม่ใช่ HTML redirect)", async ({
    page,
  }) => {
    const res = await page.request.get("/api/public/customer/00000000-0000-0000-0000-000000000000", {
      maxRedirects: 0,
    });
    expect(res.status()).not.toBe(307);
    expect(res.status()).not.toBe(302);
    const contentType = res.headers()["content-type"] || "";
    expect(contentType).toContain("application/json");
  });
});

test.describe("Middleware — ผู้ใช้ login ปกติ ต้องไม่ถูกบล็อกโดยไม่ตั้งใจ", () => {
  test("owner login แล้วเข้า / และ /jobs ได้ปกติ ไม่ถูกเด้งกลับ /login", async ({ page }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    await page.goto("/jobs");
    await expect(page).not.toHaveURL(/\/login/);

    await page.goto("/");
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("owner login แล้วเข้า /admin ได้ปกติ (สิทธิ์ผ่านทั้ง middleware และ RequireAuth role check)", async ({
    page,
  }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    await page.goto("/admin");
    await expect(page).not.toHaveURL(/\/login/);
  });
});
