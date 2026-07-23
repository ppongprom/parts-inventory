// ------------------------------------------------------------
// Regression coverage สำหรับ 3 auth/security fixes ที่ทำใน session นี้:
//   1) PIN พนักงานขั้นต่ำยกจาก 4 -> 6 ตัว (lib/staffAuth.js PIN_PATTERN,
//      app/api/team/create-staff/route.js isValidPin check)
//   2) flow "ลืมรหัสผ่าน?" ที่ /login (เดิมฟอร์มถูกซ่อนไว้เฉยๆ ไม่มีทางใช้งานได้)
//      + หน้า /reset-password ตอนไม่มี recovery session
//   3) sessionError จาก useAuth() ถูกเอามาโชว์ทั้งที่ /login และ /staff-login
//
// ไม่แตะ/ไม่ซ้ำกับ tests/concurrent-session.spec.js, tests/session.spec.js,
// tests/auth-email-login.spec.js, tests/auth-staff-login.spec.js — ไฟล์เหล่านั้น
// มี coverage ของตัวเองอยู่แล้วและถูกอัปเดตแยกต่างหาก
// ------------------------------------------------------------

import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { adminClient, getShopIdByName, signInEmail } from "../fixtures/db-client.js";
import { accounts } from "../fixtures/test-data.js";

let mainShopId;
const createdStaffUsernames = [];

test.beforeAll(async () => {
  mainShopId = await getShopIdByName("QA Test Shop (auto)");
});

test.afterAll(async () => {
  // เคลียร์บัญชีพนักงานที่สร้างผ่าน UI ระหว่างเทสต์ (shop_members row + auth.users row)
  for (const username of createdStaffUsernames) {
    const { data: member } = await adminClient()
      .from("shop_members")
      .select("member_id, user_id")
      .eq("login_username", username)
      .maybeSingle();
    if (member) {
      await adminClient().from("shop_members").delete().eq("member_id", member.member_id);
      await adminClient().auth.admin.deleteUser(member.user_id);
    }
  }
});

// ฟอร์ม "สร้างบัญชีพนักงาน (Username + PIN)" ใน app/admin/team/page.js ไม่มี htmlFor/id
// ผูก label กับ input ทุกช่อง (ช่อง PIN เป็นแค่ <div>ข้อความ + input ธรรมดา ไม่ใช่ <label>)
// เลยอ้างอิงผ่าน form ที่ครอบด้วยข้อความเฉพาะของฟอร์มนี้ แล้วไล่ตามลำดับ/placeholder ที่แน่นอน
// ในซอร์สแทน getByLabel ตรงๆ
function staffCreateForm(page) {
  return page.locator("form").filter({ hasText: "Username (ตัวพิมพ์เล็ก" });
}

async function fillStaffForm(page, { username, pin, contactName, contactPhone, role }) {
  const form = staffCreateForm(page);
  // ลำดับ input type="text" ในฟอร์มนี้ตรงกับซอร์ส: username -> pin -> contactName
  const textInputs = form.locator('input[type="text"]');
  await textInputs.nth(0).fill(username);
  await textInputs.nth(1).fill(pin);
  await textInputs.nth(2).fill(contactName);
  await form.locator('input[type="tel"]').fill(contactPhone);
  if (role) {
    await form.locator("select").selectOption(role);
  }
}

test.describe("SEC-101 — PIN พนักงานขั้นต่ำ 6 ตัว (ยกจาก 4)", () => {
  test.beforeEach(async ({ page }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto("/admin/team");
  });

  test("SEC-101a สร้างบัญชีพนักงานด้วย PIN 5 ตัว (\"12345\") ผ่าน UI -> ถูกปฏิเสธพร้อมข้อความบอก 6-20 ตัว", async ({
    page,
  }) => {
    const username = `qapin5${Date.now()}`.slice(0, 20);

    await fillStaffForm(page, {
      username,
      pin: "12345",
      contactName: "QA Short Pin Test",
      contactPhone: "0810000001",
      role: "technician",
    });
    await staffCreateForm(page).getByRole("button", { name: /สร้างบัญชีพนักงาน/ }).click();

    const errorMsg = page.locator(".msg.error");
    await expect(errorMsg).toBeVisible({ timeout: 8_000 });
    await expect(errorMsg).toContainText("6-20");

    // ต้องไม่มีบัญชีถูกสร้างขึ้นจริงเลย เพราะ validation ต้อง fail ก่อนถึงขั้นตอน createUser()
    const { data: member } = await adminClient()
      .from("shop_members")
      .select("member_id")
      .eq("login_username", username)
      .maybeSingle();
    expect(member).toBeNull();
  });

  test("SEC-101b สร้างบัญชีพนักงานด้วย PIN 6 ตัวที่ถูกต้อง -> สร้างสำเร็จ", async ({ page }) => {
    const username = `qapin6${Date.now()}`.slice(0, 20);

    await fillStaffForm(page, {
      username,
      pin: "abc123",
      contactName: "QA Valid Pin Test",
      contactPhone: "0810000002",
      role: "technician",
    });
    await staffCreateForm(page).getByRole("button", { name: /สร้างบัญชีพนักงาน/ }).click();

    const successMsg = page.locator(".msg.success");
    await expect(successMsg).toBeVisible({ timeout: 8_000 });
    await expect(successMsg).toContainText("สร้างบัญชีพนักงานสำเร็จ");
    createdStaffUsernames.push(username); // ให้ afterAll เคลียร์ทิ้ง

    const { data: member } = await adminClient()
      .from("shop_members")
      .select("member_id, role, status")
      .eq("login_username", username)
      .single();
    expect(member.role).toBe("technician");
    expect(member.status).toBe("active");
  });

  // เรียก app/api/team/create-staff/route.js ตรงๆ ข้าม UI ทั้งหมด เพื่อพิสูจน์ว่า server-side
  // validation (isValidPin จาก lib/staffAuth.js) การันตีความปลอดภัยจริง ไม่ใช่แค่ฟอร์มฝั่ง client กัน
  test("SEC-101c เรียก API /api/team/create-staff ตรงๆ ด้วย PIN 5 ตัว -> 400 พร้อมข้อความ error ตรงเป๊ะ", async ({
    page,
  }) => {
    const { client } = await signInEmail(accounts.owner.email, accounts.owner.password);
    const {
      data: { session },
    } = await client.auth.getSession();
    expect(session?.access_token).toBeTruthy();

    const username = `qaapipin5${Date.now()}`.slice(0, 20);
    const res = await page.request.post("/api/team/create-staff", {
      headers: { Authorization: `Bearer ${session.access_token}` },
      data: {
        shop_id: mainShopId,
        role: "technician",
        username,
        pin: "12345",
        contact_name: "QA Direct API Test",
        contact_phone: "0810000003",
      },
    });

    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("PIN/รหัสผ่านต้องเป็นตัวอักษรหรือตัวเลข ยาว 6-20 ตัว");

    const { data: member } = await adminClient()
      .from("shop_members")
      .select("member_id")
      .eq("login_username", username)
      .maybeSingle();
    expect(member).toBeNull();
  });
});

test.describe("SEC-102 — Forgot-password self-service flow (/login, /reset-password)", () => {
  test("SEC-102a คลิก \"ลืมรหัสผ่าน?\" ที่ /login -> ฟอร์มกรอกอีเมล + ปุ่มส่งลิงก์ปรากฏ", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#forgot_email")).toHaveCount(0);

    await page.getByRole("button", { name: "ลืมรหัสผ่าน?" }).click();

    await expect(page.locator("#forgot_email")).toBeVisible();
    await expect(page.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" })).toBeVisible();
  });

  // ⚠️ Supabase Auth จำกัดอัตราส่งอีเมล resetPasswordForEmail ต่อ address (rate limit ระดับ
  // โปรเจกต์ ไม่ใช่บั๊กแอป) — ถ้ารัน test นี้ถี่เกินไปในช่วงเวลาสั้นๆ (เช่นรันซ้ำหลายรอบตอน debug)
  // จะเจอ error "ส่งลิงก์ไม่สำเร็จ" ทั้งที่โค้ดแอปทำงานถูกต้อง เจอแบบนี้ให้เว้นช่วงแล้วรันใหม่
  // ก่อนสงสัยว่าเป็น regression จริง
  test("SEC-102b ส่งฟอร์มลืมรหัสผ่านด้วยอีเมล owner ที่มีอยู่จริง -> แสดงข้อความสำเร็จ", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "ลืมรหัสผ่าน?" }).click();
    await page.locator("#forgot_email").fill(accounts.owner.email);
    await page.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }).click();

    const successMsg = page.locator(".msg.success");
    await expect(successMsg).toBeVisible({ timeout: 10_000 });
    await expect(successMsg).toContainText("ส่งลิงก์");
    await expect(successMsg).toContainText("ตรวจสอบกล่องอีเมล");
  });

  test("SEC-102c ส่งฟอร์มลืมรหัสผ่านด้วยอีเมลที่ไม่มีในระบบ -> แสดงข้อความสำเร็จเหมือนกันทุกประการ (กันเดา/สแกนอีเมลผู้ใช้)", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "ลืมรหัสผ่าน?" }).click();
    await page.locator("#forgot_email").fill(`nonexistent-${Date.now()}@example.com`);
    await page.getByRole("button", { name: "ส่งลิงก์ตั้งรหัสผ่านใหม่" }).click();

    // ต้องไม่มี .msg.error โผล่มา และ .msg.success ต้องเป็นข้อความ generic เดียวกับ TC ก่อนหน้า
    await expect(page.locator(".msg.error")).toHaveCount(0);
    const successMsg = page.locator(".msg.success");
    await expect(successMsg).toBeVisible({ timeout: 10_000 });
    await expect(successMsg).toContainText(
      "ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว"
    );
  });

  test("SEC-102d เข้า /reset-password ตรงๆ โดยไม่มี recovery session/token -> ไม่แสดงฟอร์มตั้งรหัสผ่านใหม่ แสดงข้อความลิงก์ไม่ถูกต้อง/หมดอายุแทน", async ({
    page,
  }) => {
    await page.goto("/reset-password");

    // app/reset-password/page.js: ready && !hasRecoverySession -> .msg.error ข้อความนี้ตรงตัว
    const invalidLinkMsg = page.locator(".msg.error");
    await expect(invalidLinkMsg).toBeVisible({ timeout: 8_000 });
    await expect(invalidLinkMsg).toContainText("ลิงก์นี้ไม่ถูกต้องหรือหมดอายุแล้ว");

    // ฟอร์มตั้งรหัสผ่านใหม่ต้องไม่ถูก render เลยในสถานะนี้
    await expect(page.getByRole("button", { name: "ตั้งรหัสผ่านใหม่" })).toHaveCount(0);
  });
});

test.describe("SEC-103 — sessionError จาก AuthProvider เชื่อมเข้า /staff-login ด้วย", () => {
  // tests/concurrent-session.spec.js (TC-302a) ยืนยันพฤติกรรมนี้แบบ end-to-end บนฝั่ง /login
  // อยู่แล้ว (ต้อง login 4 บัญชีพร้อมกันใน shop tier=trial cap=3 ถึงจะ trigger sessionError จริง)
  // ฝั่ง /staff-login ต้องใช้ setup หนักแบบเดียวกัน (บัญชี username+PIN หลายตัวใน shop
  // tier=trial เดียวกัน + browser context หลายตัว) ซึ่งไม่มีอยู่ใน fixtures/test-data.js
  // ตอนนี้ (concurrentAccounts เป็นบัญชีอีเมลล้วน ไม่มีคู่ username+PIN ให้ trigger evict ทาง
  // /staff-login ได้แบบต้นทุนต่ำ) การสร้าง setup ใหม่ทั้งชุดจะซ้ำซ้อนกับ concurrent-session.spec.js
  // มาก จึง skip ไว้พร้อมเหตุผล แทนที่จะเขียน assertion ทางโครงสร้างที่ไม่ได้พิสูจน์พฤติกรรมจริง
  test.skip(
    "SEC-103a ผู้ใช้ที่ login /staff-login แล้วโดน evict session (เกิน maxConcurrentSessions) ต้องเห็นข้อความ sessionError — ต้องการ multi-context setup แบบเดียวกับ concurrent-session.spec.js TC-302a (ยังไม่มีบัญชี username+PIN หลายตัวในอู่ tier=trial ให้ทดสอบทางนี้แบบต้นทุนต่ำ)",
    async () => {}
  );
});
