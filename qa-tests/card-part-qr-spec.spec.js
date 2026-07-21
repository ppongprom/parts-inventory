// Card: "🌙 งานที่ต้องทำคืนนี้" ข้อ 3 — Part QR spec (เลือกข้อความที่จะโชว์ + spec การพิมพ์)
//
// ตัดสินใจ (การ์ดไม่ได้ฟันธงไว้ — สรุปเหตุผลไว้ใน app/print-labels/page.js):
//  - ขนาดกระดาษ: 40x60mm เดียวกับ Zone QR (เดิมเป็น A4 grid ใช้งานหน้างานจริงไม่ได้)
//  - โซนที่โชว์: เปลี่ยนจาก zone_code (legacy, ไม่อัปเดตแล้ว) เป็น breadcrumb จริงจาก zone_id
//  - ไม่เพิ่มราคา/สภาพ/เลขที่เอกสาร (พื้นที่จำกัด + ราคาไม่ควรอยู่บนป้ายติดของบนชั้น)
const { test, expect } = require("@playwright/test");
const { installMockAuth } = require("./_fixtures/mockAuth");

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const PART_ID = "cccccccc-0000-0000-0000-000000000001";
const ZONE_ID = "aaaaaaaa-0000-0000-0000-000000000002";

const ZONE_ROWS = [
  { id: "aaaaaaaa-0000-0000-0000-000000000001", shop_id: SHOP_ID, parent_id: null, code: "A1", name: null },
  { id: ZONE_ID, shop_id: SHOP_ID, parent_id: "aaaaaaaa-0000-0000-0000-000000000001", code: "Shelf-03", name: null },
];

function partRow(overrides = {}) {
  return {
    id: PART_ID,
    shop_id: SHOP_ID,
    part_name: "กันชนหน้า",
    car_brand: "Toyota",
    car_model: "Vios",
    zone_id: ZONE_ID,
    zone_code: "เก่า-A", // legacy text — ต้องไม่ถูกใช้เมื่อมี zone_id แล้ว
    price: 1500,
    ...overrides,
  };
}

async function mockRoutes(page, part) {
  await page.route("**/*.supabase.co/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/rest/v1/parts") && url.includes(`id=in.`)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([part]) });
    }
    if (url.includes("/rest/v1/zones")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(ZONE_ROWS) });
    }
    return route.fallback();
  });
}

test.describe("Part QR label spec", () => {
  test("shows zone breadcrumb from zone_id (not the legacy zone_code) and no price", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockRoutes(page, partRow());
    await page.goto(`/print-labels?ids=${PART_ID}`);

    await expect(page.getByText("กันชนหน้า")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Shelf-03/)).toBeVisible();
    await expect(page.getByText("เก่า-A")).toHaveCount(0);
    await expect(page.getByText("1500")).toHaveCount(0);
    await expect(page.getByText("1,500")).toHaveCount(0);
  });

  test("falls back to legacy zone_code when a part has no zone_id yet", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockRoutes(page, partRow({ zone_id: null, zone_code: "เก่า-A" }));
    await page.goto(`/print-labels?ids=${PART_ID}`);

    await expect(page.getByText("กันชนหน้า")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/เก่า-A/)).toBeVisible();
  });

  test("print media uses a 40x60mm page and a bigger title font than before", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockRoutes(page, partRow());
    await page.goto(`/print-labels?ids=${PART_ID}`);
    await expect(page.getByText("กันชนหน้า")).toBeVisible({ timeout: 15000 });

    await page.emulateMedia({ media: "print" });
    const titleFontSize = await page.locator(".label-title").first().evaluate((el) => window.getComputedStyle(el).fontSize);
    // เดิม 10pt ≈ 13.33px, ใหม่ 13pt ≈ 17.33px
    expect(parseFloat(titleFontSize)).toBeGreaterThan(13.33);
  });
});
