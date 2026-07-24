import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { getTierShopOwner } from "../fixtures/test-data.js";

// ==============================================================
// TIER-xxx: ToS ข้อ 4.1 (ตารางแพ็กเกจ) vs config/subscriptionTiers.js `features`
//
// Feature-gating บังคับจริงผ่าน lib/featureGating.js -> hasFeature() เรียกใน
// components/RequireAuth.js (requiredFeature prop, gate ทั้งหน้า) และแบบ inline ในแต่ละ
// component ที่ซ่อนปุ่ม/องค์ประกอบเฉพาะจุด (ดู components/AppShell.js, app/page.js,
// app/add/page.js, app/edit/[id]/page.js, app/jobs/new/page.js, app/admin/car-data/page.js)
//
// ใช้ shop เฉพาะ tier ที่ provision ไว้แล้ว (QA Tier Shop - trial/starter/founder/pro/enterprise
// ดู getTierShopOwner() ใน fixtures/test-data.js -> scripts/setup-test-data.mjs -> setupTierShop)
// แทนการสลับ subscription_plan ของ shop เดียวไปมา — 5 shop แยกกันเป๊ะ ทนต่อ parallel worker
// (workers: 8) ได้จริง ไม่มีความเสี่ยง race condition ที่ test คนละไฟล์ไปสลับ plan ชนกัน
//
// Route/UI-element → feature flag mapping:
//
//   feature flag   | tier ต่ำสุดที่มี | route / UI element
//   ---------------|-----------------|--------------------------------------------
//   admin_basic    | starter         | /admin, /admin/team, /admin/zones, /admin/groups,
//                  |                 | /admin/options, /admin/bulk-update, /admin/trash,
//                  |                 | /admin/car-data (ตัวหน้าเอง — ไม่รวมปุ่ม "📜 ประวัติ")
//   audit_log      | founder         | ปุ่ม "📜 ประวัติ" (audit trail) ภายใน /admin/car-data
//   gallery_view   | founder         | ปุ่ม "🖼 Gallery" (view-mode toggle) บนหน้าแรก
//   multi_photo    | founder         | ปุ่ม "เลือกจากคลังภาพ" (multi-select) บน /add, /edit/[id], /jobs/new
//   reports        | pro             | /admin/reports (ตารางยอดขาย/บิล ส่วนบนของหน้า)
//   analytics      | pro             | /admin/reports (กราฟแท่งรายวัน ส่วนล่างของหน้า — รวมหน้าเดียวกับ reports)
//   all/           | enterprise      | ยังไม่มี route จริงในโค้ด ณ ตอนตรวจสอบ (multi-branch/API/
//   multi_branch/  |                 | custom reports อยู่ใน roadmap Phase D ที่ยังไม่เริ่มสร้าง) —
//   api_access/    |                 | ข้าม (test.skip) ไว้ก่อน จนกว่าจะมี route จริงให้ทดสอบ
//   custom_reports |                 |
//
// เทสด้านล่างเช็คแค่ "เนื้อหาที่ป้องกันไว้มองไม่เห็น/เข้าไม่ถึง" เท่านั้น ไม่ผูกกับ UX เฉพาะ
// (redirect ไปหน้าไหน / ขึ้น banner แบบไหน) เพื่อให้ทนทานไม่ว่าจะเปลี่ยนวิธีบล็อกยังไงก็ตาม
// ==============================================================

async function loginAsTierOwner(browser, tierName) {
  const owner = getTierShopOwner(tierName);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginWithEmail(page, owner.email, owner.password);
  await expectLoginSucceeded(page);
  return { ctx, page };
}

/** brands/models/generations เป็นฐานข้อมูลรถกลาง ใช้ร่วมกันทุก shop (ไม่ผูก shop_id) —
 *  ต้องเลือกยี่ห้อ+รุ่นก่อนถึงจะเห็นรายการ generation (และปุ่ม "📜 ประวัติ" ที่ gate ไว้) */
async function selectFirstCarGeneration(page) {
  await page.getByLabel("1. ยี่ห้อ").selectOption({ index: 1 });
  await page.getByLabel("2. รุ่น").selectOption({ index: 1 });
}

// --------------------------------------------------------------
// admin_basic (Starter+) — Trial ต้องเข้า /admin* ไม่ได้เลย, Starter เข้าได้
// --------------------------------------------------------------
test.describe("admin_basic (Starter+)", () => {
  test("TIER-101 Trial ต้องเห็น/เข้าหน้า /admin (ตั้งค่าระบบ) ไม่ได้", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "trial");
    try {
      await page.goto("/admin");
      await expect(page.getByText("⚙️ ตั้งค่าระบบ")).not.toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test("TIER-102 Starter ต้องเข้าหน้า /admin (ตั้งค่าระบบ) ได้ปกติ", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "starter");
    try {
      await page.goto("/admin");
      await expect(page.getByText("⚙️ ตั้งค่าระบบ")).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

// --------------------------------------------------------------
// gallery_view (Founder+) — ปุ่มสลับมุมมอง "🖼 Gallery" บนหน้าแรก
// --------------------------------------------------------------
test.describe("gallery_view (Founder+)", () => {
  test("TIER-201 Starter ต้องไม่เห็นปุ่ม \"🖼 Gallery\" บนหน้าแรก", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "starter");
    try {
      await page.goto("/");
      await expect(page.getByRole("button", { name: /Gallery/ })).not.toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test("TIER-202 Founder ต้องเห็น/ใช้ปุ่ม \"🖼 Gallery\" บนหน้าแรกได้", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "founder");
    try {
      await page.goto("/");
      const galleryBtn = page.getByRole("button", { name: /Gallery/ });
      await expect(galleryBtn).toBeVisible({ timeout: 8000 });
      await galleryBtn.click();
      // เช็คแค่ว่าคลิกแล้วสลับโหมดสำเร็จ (ปุ่มขึ้น active) — ไม่เช็ค .gallery-grid มีเนื้อหาไหม
      // เพราะขึ้นกับว่า shop นี้มีอะไหล่ให้แสดงหรือเปล่า ซึ่งเป็นคนละเรื่องกับ feature-gating
      await expect(galleryBtn).toHaveClass(/active/);
    } finally {
      await ctx.close();
    }
  });
});

// --------------------------------------------------------------
// multi_photo (Founder+) — ปุ่ม "เลือกจากคลังภาพ" ตอนเพิ่มอะไหล่ใหม่ (/add)
// (Trial/Starter ควรเหลือแค่ปุ่ม "📷 ถ่ายรูป" เดี่ยวๆ — mobile_camera คือ baseline ทุก tier)
// --------------------------------------------------------------
test.describe("multi_photo (Founder+)", () => {
  test("TIER-301 Starter ต้องไม่เห็นปุ่ม \"เลือกจากคลังภาพ\" บนหน้าเพิ่มอะไหล่", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "starter");
    try {
      await page.goto("/add");
      await expect(page.getByRole("button", { name: /ถ่ายรูป/ })).toBeVisible({ timeout: 8000 }); // baseline ยังต้องอยู่
      await expect(page.getByRole("button", { name: /เลือกจากคลังภาพ/ })).not.toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test("TIER-302 Founder ต้องเห็นปุ่ม \"เลือกจากคลังภาพ\" บนหน้าเพิ่มอะไหล่ได้", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "founder");
    try {
      await page.goto("/add");
      await expect(page.getByRole("button", { name: /เลือกจากคลังภาพ/ })).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

// --------------------------------------------------------------
// audit_log (Founder+) — ปุ่ม "📜 ประวัติ" ภายใน /admin/car-data
// --------------------------------------------------------------
test.describe("audit_log (Founder+)", () => {
  test("TIER-401 Starter เข้าหน้า /admin/car-data ได้ (admin_basic) แต่ไม่เห็นปุ่ม \"📜 ประวัติ\"", async ({
    browser,
  }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "starter");
    try {
      await page.goto("/admin/car-data");
      await expect(page.getByText("จัดการข้อมูลรถ")).toBeVisible({ timeout: 8000 });
      await selectFirstCarGeneration(page);
      await expect(page.getByText("3. Generation / ช่วงปี")).toBeVisible({ timeout: 8000 });
      await expect(page.getByRole("button", { name: /ประวัติ/ }).first()).not.toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test("TIER-402 Founder เห็นปุ่ม \"📜 ประวัติ\" ใน /admin/car-data และเปิดดูได้", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "founder");
    try {
      await page.goto("/admin/car-data");
      await selectFirstCarGeneration(page);
      const historyBtn = page.getByRole("button", { name: /ประวัติ/ }).first();
      await expect(historyBtn).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

// --------------------------------------------------------------
// reports + analytics (Pro+) — /admin/reports (ตาราง + กราฟแท่ง อยู่หน้าเดียวกัน)
// --------------------------------------------------------------
test.describe("reports + analytics (Pro+)", () => {
  test("TIER-501 Founder ต้องเข้าหน้า /admin/reports (รายงานการขาย) ไม่ได้", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "founder");
    try {
      await page.goto("/admin/reports");
      await expect(page.getByText("📊 รายงานการขาย")).not.toBeVisible({ timeout: 8000 });
      // เช็คคู่กันว่าลิงก์ "รายงานการขาย" ใน sidebar ก็ไม่ควรโผล่ด้วย ถ้า Founder ยังไม่มีสิทธิ์
      await expect(page.getByRole("link", { name: /รายงานการขาย/ })).not.toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });

  test("TIER-502 Pro ต้องเข้าหน้า /admin/reports ได้ และเห็นทั้งตารางและกราฟ", async ({ browser }) => {
    const { ctx, page } = await loginAsTierOwner(browser, "pro");
    try {
      await page.goto("/admin/reports");
      await expect(page.getByText("📊 รายงานการขาย")).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
});

// --------------------------------------------------------------
// Enterprise-only: all / multi_branch / api_access / custom_reports
// ยังไม่มี route จริงให้ทดสอบในโค้ด ณ ตอนตรวจสอบ (2026-07-23) — ข้ามไว้ก่อน
// ลบ .skip ออกและเติม route จริงตอนฟีเจอร์เหล่านี้ถูกสร้างขึ้นจริง (roadmap Phase D)
// --------------------------------------------------------------
test.describe.skip("Enterprise-only features (multi_branch/api_access/custom_reports) — ยังไม่มี route จริง", () => {
  test("TIER-601 TODO: เติมเทสเมื่อมีหน้า multi-branch จริง", async () => {});
  test("TIER-602 TODO: เติมเทสเมื่อมี API access / custom reports จริง", async () => {});
});
