// Card: "ย้ายอะไหล่ระหว่าง Zone — action ใหม่ พร้อม owner_type override checkbox"
//
// ขอบเขต: ย้ายทีละชิ้น "ภายในสาขาเดียวกัน" เท่านั้น (ข้ามสาขา = การ์ดแยก "โอนอะไหล่ข้ามสาขา")
//
// งานที่ทำไปแล้วก่อนหน้านี้ในเซสชันนี้เอง (ดูหมายเหตุ "ความคืบหน้าบางส่วน" ในการ์ด — ไม่ทำซ้ำ):
// พิมพ์ QR label โซน, สแกน QR โซน -> /zone/[id], bulk move ทั้งโซนที่ /move-parts, ปุ่มสแกนตำแหน่ง
// ใน /add และ /edit — การ์ดนี้ทำส่วนที่เหลือ: action ย้ายทีละชิ้นที่ /move-part/[id] (ลิงก์จาก
// /edit/[id]), เช็ค owner_type ปลายทาง vs ปัจจุบัน + checkbox override, toggle ร้าน "บังคับสแกน QR"
// ที่ /admin (มีเทสแยกสำหรับ toggle ใน describe บล็อกที่ 3 ด้านล่าง)
//
// เรื่อง log การย้าย: ไม่มีเทสตรงๆ ในไฟล์นี้ — ใช้ audit_log กลาง (trg_audit_parts) ที่มีเทสอยู่แล้ว
// ใน card-audit-log-parts-coverage.spec.js ครอบคลุมอยู่ (การ update นี้ก็แค่ UPDATE บน parts ปกติ)
const { test, expect } = require("@playwright/test");
const { installMockAuth } = require("./_fixtures/mockAuth");

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const PART_ID = "dddddddd-0000-0000-0000-000000000001";
const OWN_ZONE_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CONSIGN_ZONE_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const ZONE_ROWS = [
  { id: OWN_ZONE_ID, shop_id: SHOP_ID, parent_id: null, code: "A1", name: null, owner_type: "own" },
  { id: CONSIGN_ZONE_ID, shop_id: SHOP_ID, parent_id: null, code: "B1", name: null, owner_type: "consignment" },
];

function partRow(overrides = {}) {
  return {
    id: PART_ID,
    shop_id: SHOP_ID,
    part_name: "ไฟท้าย",
    zone_id: OWN_ZONE_ID,
    zone_code: null,
    owner_type_override: null,
    ...overrides,
  };
}

async function mockMovePartRoutes(page, { part, forceZoneScan = false, patchCapture }) {
  await page.route("**/*.supabase.co/**", async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    if (url.includes("/rest/v1/parts") && url.includes(`id=eq.${PART_ID}`)) {
      if (method === "PATCH") {
        const body = req.postDataJSON();
        if (patchCapture) patchCapture.push(body);
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(part) });
    }
    if (url.includes("/rest/v1/zones")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONE_ROWS) });
    }
    if (url.includes("/rest/v1/shops")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ force_zone_scan_confirmation: forceZoneScan }),
      });
    }
    return route.fallback();
  });
}

test.describe("Zone move action (/move-part/[id])", () => {
  test("same owner_type on both ends — no override checkbox, plain move", async ({ page }) => {
    const patchCapture = [];
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockMovePartRoutes(page, { part: partRow({ zone_id: OWN_ZONE_ID }), patchCapture });
    await page.goto(`/move-part/${PART_ID}`);

    await expect(page.getByText("📍 ย้าย Zone — ไฟท้าย")).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2").fill("A1");
    await page.getByText("A1", { exact: true }).last().click();

    await expect(page.getByTestId("owner-type-override-checkbox")).toHaveCount(0);
    await page.getByRole("button", { name: "ยืนยันย้าย" }).click();

    await expect.poll(() => patchCapture.length).toBeGreaterThan(0);
    expect(patchCapture[0]).toMatchObject({ zone_id: OWN_ZONE_ID, owner_type_override: null });
  });

  test("mismatched owner_type shows the override checkbox; checking it preserves the old owner_type", async ({ page }) => {
    const patchCapture = [];
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockMovePartRoutes(page, { part: partRow({ zone_id: OWN_ZONE_ID }), patchCapture });
    await page.goto(`/move-part/${PART_ID}`);

    await expect(page.getByText("📍 ย้าย Zone — ไฟท้าย")).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2").fill("B1");
    await page.getByText("B1", { exact: true }).last().click();

    const checkbox = page.getByTestId("owner-type-override-checkbox");
    await expect(checkbox).toBeVisible();
    await expect(checkbox).toContainText("ของร้านเอง");
    await expect(checkbox).toContainText("ฝากขาย");

    await checkbox.locator("input").check();
    await page.getByRole("button", { name: "ยืนยันย้าย" }).click();

    await expect.poll(() => patchCapture.length).toBeGreaterThan(0);
    expect(patchCapture[0]).toMatchObject({ zone_id: CONSIGN_ZONE_ID, owner_type_override: "own" });
  });

  test("mismatched owner_type, checkbox left unchecked -> adopts the new zone's owner_type", async ({ page }) => {
    const patchCapture = [];
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockMovePartRoutes(page, { part: partRow({ zone_id: OWN_ZONE_ID }), patchCapture });
    await page.goto(`/move-part/${PART_ID}`);

    await expect(page.getByText("📍 ย้าย Zone — ไฟท้าย")).toBeVisible({ timeout: 15000 });
    await page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2").fill("B1");
    await page.getByText("B1", { exact: true }).last().click();
    await expect(page.getByTestId("owner-type-override-checkbox")).toBeVisible();

    // ไม่ติ๊ก — ยืนยันตรงๆ เลย
    await page.getByRole("button", { name: "ยืนยันย้าย" }).click();

    await expect.poll(() => patchCapture.length).toBeGreaterThan(0);
    expect(patchCapture[0]).toMatchObject({ zone_id: CONSIGN_ZONE_ID, owner_type_override: null });
  });

  test("shop with force_zone_scan_confirmation ON hides the manual zone search box", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockMovePartRoutes(page, { part: partRow(), forceZoneScan: true, patchCapture: [] });
    await page.goto(`/move-part/${PART_ID}`);

    await expect(page.getByText("📍 ย้าย Zone — ไฟท้าย")).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2")).toHaveCount(0);
    await expect(page.getByTestId("zone-scan-button")).toBeVisible();
    await expect(page.getByText(/บังคับสแกน QR ยืนยันตำแหน่ง/)).toBeVisible();
  });
});

test.describe("/add respects the force_zone_scan_confirmation shop setting", () => {
  test("force scan ON hides the manual zone search box on /add", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await page.route("**/*.supabase.co/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/rest/v1/zones")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONE_ROWS) });
      }
      if (url.includes("/rest/v1/shops")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ force_zone_scan_confirmation: true }),
        });
      }
      return route.fallback();
    });
    await page.goto("/add");

    await expect(page.getByTestId("zone-scan-button")).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2")).toHaveCount(0);
    await expect(page.getByText(/บังคับสแกน QR ยืนยันตำแหน่ง/)).toBeVisible();
  });

  test("force scan OFF keeps the manual zone search box on /add (default, unchanged behavior)", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await page.route("**/*.supabase.co/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/rest/v1/zones")) {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONE_ROWS) });
      }
      if (url.includes("/rest/v1/shops")) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ force_zone_scan_confirmation: false }),
        });
      }
      return route.fallback();
    });
    await page.goto("/add");

    await expect(page.getByPlaceholder("พิมพ์ค้นหาโซน เช่น Shelf 03 ชั้น 2")).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Admin: force-zone-scan toggle", () => {
  test("owner can flip the setting and it persists via update", async ({ page }) => {
    let currentValue = false;
    const patchCapture = [];
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await page.route("**/*.supabase.co/**", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.includes("/rest/v1/shops")) {
        if (req.method() === "PATCH") {
          const body = req.postDataJSON();
          currentValue = body.force_zone_scan_confirmation;
          patchCapture.push(body);
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ company_name: "", address: "", tax_id: "", phone: "", force_zone_scan_confirmation: currentValue }),
        });
      }
      return route.fallback();
    });
    await page.goto("/admin");

    await expect(page.getByText("📍 บังคับสแกน QR ยืนยันตำแหน่ง")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("toggle-force-scan")).toContainText("ปิดอยู่");
    await page.getByTestId("toggle-force-scan").click();

    await expect.poll(() => patchCapture.length).toBeGreaterThan(0);
    expect(patchCapture[0]).toMatchObject({ force_zone_scan_confirmation: true });
  });
});
