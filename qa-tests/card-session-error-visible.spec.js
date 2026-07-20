// Card: "บั๊ก: sessionError ไม่เคยแสดงผลให้ user เห็น (silent session kick)" (ขนาดงาน: S)
//
// อาการเดิม: AuthProvider เซ็ต sessionError ไว้ตอน registerSession() ล้มเหลว (เช่น ชนกับ
// concurrent session limit ของ tier) แต่ไม่มีหน้าไหนเอามาเรนเดอร์เลย — user โดนเด้งกลับ
// /login เฉยๆ ไม่รู้สาเหตุ
//
// Fix: /login และ /staff-login อ่าน sessionError จาก useAuth() แล้วโชว์เป็น error message
// (ใช้ mechanism เดิมที่มีอยู่แล้วคือ AuthProvider context — persist ข้ามการ redirect ไป
// /login ได้เองเพราะ router.replace() เป็น client-side navigation ไม่ unmount AuthProvider
// ที่อยู่ใน root layout)
const { test, expect } = require("@playwright/test");
const { installMockAuth } = require("./_fixtures/mockAuth");

test.describe("sessionError is now visible to the user", () => {
  test("concurrent session limit rejection shows an explanatory message on /login (not a silent redirect)", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    // ใช้ tier "trial" (maxConcurrentSessions=3) แล้ว mock ให้อู่นี้มีคนอื่น login อยู่แล้ว 3
    // คนพอดี (ครบ limit) เพื่อบังคับให้ registerSession() ปฏิเสธการเข้าใช้งานของเรา
    await installMockAuth(page, {
      role: "owner",
      shopId: "11111111-1111-1111-1111-111111111111",
      memberships: [
        {
          member_id: "22222222-2222-2222-2222-222222222222",
          shop_id: "11111111-1111-1111-1111-111111111111",
          role: "owner",
          status: "active",
          login_username: null,
          contact_name: "QA Owner",
          shops: { shop_name: "QA Test Shop", subscription_status: "active", subscription_plan: "trial" },
        },
      ],
    });

    // ต้อง register หลัง installMockAuth เพื่อให้ page.route ของเราทำงานก่อน (ล่าสุด = ทำงานก่อน)
    // ส่วน request อื่นที่ไม่เกี่ยวกับ user_sessions ปล่อยให้ mockAuth เดิมจัดการต่อด้วย route.fallback()
    await page.route("**/*.supabase.co/**", async (route) => {
      const req = route.request();
      const url = req.url();
      if (url.includes("/rest/v1/user_sessions")) {
        if (req.method() === "DELETE") {
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (url.includes("user_id=eq.")) {
          // ขั้นตอน 1: เช็คจำนวนเครื่องของ user นี้เอง — ยังไม่เคย login เครื่องไหนมาก่อน
          return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        }
        if (url.includes("shop_id=eq.")) {
          // ขั้นตอน 2: เช็คจำนวนคนอื่นที่ login พร้อมกันในอู่นี้ — ให้ครบ limit (3 คนสำหรับ trial)
          // พอดี เพื่อบังคับ reject
          return route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
              { user_id: "other-user-1" },
              { user_id: "other-user-2" },
              { user_id: "other-user-3" },
            ]),
          });
        }
      }
      return route.fallback();
    });

    await page.goto("/");

    // ควรถูกเด้งกลับ /login พร้อมข้อความอธิบายว่าเต็ม ไม่ใช่แค่เด้งเฉยๆ
    await page.waitForURL(/\/login/, { timeout: 15000 });
    await expect(page.getByText(/คนใช้งานพร้อมกันเต็มแล้ว/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/3\/3/)).toBeVisible();

    expect(pageErrors, `Unexpected client-side JS errors: ${pageErrors.join("; ")}`).toEqual([]);
  });
});
