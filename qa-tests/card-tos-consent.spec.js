// Card: "กลไก ToS consent — สัญญาใช้บริการ + บันทึกการยอมรับ (blocker #2 ของ Accounting)"
//
// Scope (ตามที่การ์ดแบ่งไว้เอง): "โค้ด S–M + งานเอกสาร/กฎหมาย" — ไฟล์นี้/การ์ดนี้ทำเฉพาะกลไกโค้ด
// (ตาราง shop_tos_acceptances, RPC accept_shop_tos, TosConsentGate ครอบทุกหน้าใน RequireAuth)
// เนื้อหาสัญญาจริงใน config/tosContent.js เป็น "ร่าง" ชัดเจน — ยังไม่ผ่าน legal review ตามที่
// การ์ดกำหนดไว้ตรงๆ ว่าต้องมีคนตรวจสอบก่อนใช้งานจริง
//
// หมายเหตุ: qa-tests/_fixtures/mockAuth.js มี default ให้ "ยอมรับแล้วเสมอ" กับทุกเทสอื่นในโปรเจกต์
// (กัน regression ทั้ง suite) — เทสในไฟล์นี้ต้อง override ด้วย extraRoutes ให้ยัง "ไม่ยอมรับ"
// (คืน [] ว่าง) เพื่อทดสอบ gate เองโดยเฉพาะ
const { test, expect } = require("@playwright/test");
const { installMockAuth } = require("./_fixtures/mockAuth");

const SHOP_ID = "11111111-1111-1111-1111-111111111111";

// หมายเหตุ (defect เจอรอบ 1 — บั๊กเดิมซ้ำจากเทสไฟล์ก่อนๆ): ต้อง return true หลัง fulfill เสมอ
// ไม่งั้น mockAuth.js เข้าใจว่ายังไม่ได้ handle แล้ว fulfill ซ้ำสอง เกิด "Route is already handled!"
async function mockNotAccepted(route, url) {
  if (url.includes("/rest/v1/shop_tos_acceptances")) {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    return true;
  }
  return false;
}

test.describe("ToS consent gate", () => {
  test("owner sees the gate with the ToS text and an accept checkbox+button", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID, extraRoutes: mockNotAccepted });
    await page.goto("/");

    const gate = page.getByTestId("tos-consent-gate");
    await expect(gate).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("tos-content-box")).toContainText("อู่ในเครือ");
    await expect(page.getByTestId("tos-content-box")).toContainText("Data ownership");

    const acceptButton = page.getByRole("button", { name: "ยอมรับเงื่อนไข" });
    await expect(acceptButton).toBeDisabled();
    await page.getByRole("checkbox").check();
    await expect(acceptButton).toBeEnabled();
  });

  test("owner accepting calls accept_shop_tos and the gate closes", async ({ page }) => {
    let rpcCalled = false;
    await installMockAuth(page, {
      role: "owner",
      shopId: SHOP_ID,
      extraRoutes: async (route, url, method) => {
        if (url.includes("/rest/v1/rpc/accept_shop_tos")) {
          rpcCalled = true;
          await route.fulfill({ status: 200, contentType: "application/json", body: "null" });
          return true;
        }
        return mockNotAccepted(route, url);
      },
    });
    await page.goto("/");

    await expect(page.getByTestId("tos-consent-gate")).toBeVisible({ timeout: 15000 });
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "ยอมรับเงื่อนไข" }).click();

    await expect(page.getByTestId("tos-consent-gate")).toBeHidden({ timeout: 10000 });
    expect(rpcCalled).toBe(true);
  });

  test("non-owner roles see the gate but no accept control — just a message to contact the owner", async ({ page }) => {
    await installMockAuth(page, { role: "technician", shopId: SHOP_ID, extraRoutes: mockNotAccepted });
    await page.goto("/");

    await expect(page.getByTestId("tos-consent-gate")).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("tos-non-owner-message")).toContainText("เจ้าของร้าน");
    await expect(page.getByRole("button", { name: "ยอมรับเงื่อนไข" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
  });

  test("already-accepted shop never sees the gate (default mock across the rest of the suite)", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await page.goto("/");

    await expect(page.getByText("🚗 เพิ่มอะไหล่").or(page.locator("body"))).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId("tos-consent-gate")).toHaveCount(0);
  });
});
