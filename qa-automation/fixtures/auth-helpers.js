// ------------------------------------------------------------
// Helper ที่อ้างอิง selector จริงจาก source code (branch: staging)
//   app/login/page.js        -> label "อีเมล" / "รหัสผ่าน", ปุ่ม "เข้าสู่ระบบ"
//   app/staff-login/page.js  -> label "Username" / "PIN / รหัสผ่าน", ปุ่ม "เข้าสู่ระบบ"
//   components/RequireAuth.js -> ข้อความ error ตาม role, หน้า disabled/expired account
//   components/TosConsentGate.js -> gate ที่ครอบทุกหน้าหลัง RequireAuth (เพิ่มคืน 21 ก.ค. 2026)
// ถ้า markup ในโค้ดเปลี่ยนไปจากตอนที่ตรวจสอบ ให้แก้ selector ตรงนี้ที่เดียว
// ------------------------------------------------------------

import { expect } from "@playwright/test";

export async function loginWithEmail(page, email, password) {
  await page.goto("/login");
  await page.getByLabel("อีเมล").fill(email);
  await page.getByLabel("รหัสผ่าน").fill(password);
  await page.getByRole("button", { name: /เข้าสู่ระบบ/ }).click();
}

export async function loginWithStaffPin(page, username, pin) {
  await page.goto("/staff-login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel(/PIN/).fill(pin);
  await page.getByRole("button", { name: /เข้าสู่ระบบ/ }).click();
}

/** รอจน login สำเร็จแล้ว redirect ออกจากหน้า /login หรือ /staff-login */
export async function expectLoginSucceeded(page) {
  await expect(page).not.toHaveURL(/\/login|\/staff-login/, { timeout: 10_000 });
}

/** ตรวจว่า login ล้มเหลว และยังค้างอยู่หน้าเดิมพร้อม error message */
export async function expectLoginFailed(page, { onPath } = {}) {
  const errorLocator = page.locator(".msg.error");
  await expect(errorLocator).toBeVisible({ timeout: 8_000 });
  if (onPath) {
    await expect(page).toHaveURL(new RegExp(onPath));
  }
  return errorLocator;
}

/** ตรวจว่าหน้าปัจจุบันแสดง RequireAuth role-forbidden message */
export async function expectRoleForbidden(page, roleName) {
  const forbidden = page.locator(".msg.error", {
    hasText: `บทบาท "${roleName}" ของคุณไม่มีสิทธิ์เข้าหน้านี้`,
  });
  await expect(forbidden).toBeVisible({ timeout: 8_000 });
}

/** ตรวจว่าหน้าปัจจุบันคือหน้า disabled-account จาก RequireAuth.js */
export async function expectDisabledAccountScreen(page) {
  await expect(page.getByText("บัญชีนี้ถูกปิดการใช้งาน")).toBeVisible({ timeout: 8_000 });
  await expect(
    page.getByRole("button", { name: "ออกจากระบบ" })
  ).toBeVisible();
}

/** ตรวจว่าหน้าปัจจุบันคือหน้า expired-account จาก RequireAuth.js (การ์ด "Field Scanner Role" —
 *  shop_members.expires_at ผ่านไปแล้ว) data-testid="expired-account-screen" */
export async function expectExpiredAccountScreen(page) {
  await expect(page.getByTestId("expired-account-screen")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("บัญชีชั่วคราวนี้หมดอายุแล้ว")).toBeVisible();
}

/** ตรวจว่าถูก redirect ไปหน้า /signup (memberships.length === 0) */
export async function expectRedirectedToSignup(page) {
  await expect(page).toHaveURL(/\/signup/, { timeout: 8_000 });
}

export async function signOut(page) {
  // ปรับ selector ตรงนี้ถ้า AppShell ใช้ label อื่นสำหรับปุ่ม sign out
  // (เดิม guard ด้วย isVisible().catch(() => false) ก่อน click — isVisible() เป็น point-in-time
  // check ไม่รอ element โผล่เหมือน click() ที่ auto-wait ในตัว ถ้าเรียกเร็วไปตอนหน้ายังไม่ hydrate
  // เสร็จ ปุ่มยังไม่ทันโผล่ isVisible() จะคืน false ทันทีแล้วข้าม click ไปเงียบๆ — เรียก click()
  // ตรงๆ ให้ Playwright auto-wait ให้ปุ่ม actionable เองแทน)
  await page.getByRole("button", { name: /ออกจากระบบ|sign ?out/i }).click();
}

// ------------------------------------------------------------
// การ์ด "กลไก ToS consent" (คืนวันที่ 21 ก.ค. 2026) — components/TosConsentGate.js
// ครอบทุกหน้าที่ผ่าน RequireAuth บล็อกจนกว่า owner ของร้านจะกดยอมรับเวอร์ชันล่าสุด
// setup-test-data.mjs seed shop_tos_acceptances ให้ทุก shop หลักไว้ล่วงหน้าแล้ว (กัน suite อื่น
// โดน gate บล็อกโดยไม่ตั้งใจ) — helper พวกนี้มีไว้สำหรับ tests/card-tos-consent.spec.js ที่ตั้งใจ
// ทดสอบตัว gate เองบน shop ที่ยังไม่เคย accept เท่านั้น
// ------------------------------------------------------------

export async function expectTosGateVisible(page) {
  await expect(page.getByTestId("tos-consent-gate")).toBeVisible({ timeout: 10_000 });
}

export async function expectTosGateHidden(page) {
  await expect(page.getByTestId("tos-consent-gate")).toBeHidden({ timeout: 10_000 });
}

export async function expectTosNonOwnerMessage(page) {
  await expect(page.getByTestId("tos-non-owner-message")).toBeVisible({ timeout: 8_000 });
}

/** ต้องเป็น owner ของร้านที่กำลังดู gate อยู่เท่านั้นถึงจะกดผ่านได้ (role อื่นไม่มีปุ่มนี้) */
export async function acceptTosGate(page) {
  await page.getByTestId("tos-consent-gate").getByRole("checkbox").check();
  await page.getByRole("button", { name: "ยอมรับเงื่อนไข" }).click();
}
