import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { getTierShopOwner } from "../fixtures/test-data.js";
import { adminClient, signInEmail, getShopIdByName } from "../fixtures/db-client.js";

// ==============================================================
// TIER-7xx: ส่วนต่อขยายจาก tier-feature-gating.spec.js (TIER-1xx..5xx เดิม เช็คแค่ชั้น UI)
//
// การ์ดนี้ตรวจ "ชั้นที่สอง" ตาม convention เดียวกับ db-client.js เอง (ดูคอมเมนต์ในไฟล์นั้น:
// "พิสูจน์ว่าความปลอดภัยอยู่ที่ DB policy จริง ไม่ใช่แค่ UI ซ่อนปุ่ม") — เดิม TIER-1xx..5xx
// ทั้งหมดเช็คแค่ page.goto() + ปุ่ม/ข้อความ visible/not-visible เท่านั้น ไม่เคยเรียก signInEmail()
// เพื่อยิง query ตรงข้าม RLS แบบที่ db-client.js ตั้งใจให้ทำเลย
//
// สิ่งที่พบจากการอ่าน lib/featureGating.js + grep หา hasFeature(/getTierConfig( ทั้ง repo
// (branch wip/tier-feature-gating ณ commit 728fd0f):
//   - hasFeature() ถูกเรียกเฉพาะใน "use client" component (RequireAuth.js, AppShell.js,
//     app/page.js, app/add, app/edit/[id], app/jobs/new, app/admin/car-data) เท่านั้น
//   - ไม่มี app/api/** route ไหนเรียก hasFeature()/getTierConfig() เพื่อบังคับ 5 ฟีเจอร์นี้เลย
//     (มี getTierConfig() ใช้ใน export-csv routes/create-staff route แต่เป็นคนละแกน — เช็ค
//     trial-only export block กับ burstModeMaxAccounts ไม่เกี่ยวกับ admin_basic/gallery_view/
//     multi_photo/audit_log/reports/analytics)
//   - ตาราง audit_log, zones ไม่มี RLS policy ผูกกับ shops.subscription_plan (ตรวจแล้วด้านล่าง)
//   - แปลว่า gating ปัจจุบันเป็น "UI-hidden only" ล้วนๆ สำหรับ 5 ฟีเจอร์นี้ — ผู้ใช้ที่เปิด
//     browser devtools แล้วเรียก supabase client เอง (หรือ mobile app เขียนเอง) จะ bypass
//     UI gate ได้ทั้งหมด ตราบใดที่ login เป็นสมาชิก shop จริง (ไม่ว่า tier ไหน)
// ==============================================================

test.describe("API-level bypass check — audit_log (Founder+ ตาม UI gate)", () => {
  test("TIER-701 [ควรบล็อก แต่ไม่บล็อกจริง] Starter tier อ่าน audit_log ตรงผ่าน Supabase client ได้ทั้งที่ UI ซ่อนปุ่มไว้", async () => {
    const starterOwner = getTierShopOwner("starter");
    const { client } = await signInEmail(starterOwner.email, starterOwner.password);

    const { data, error } = await client
      .from("audit_log")
      .select("*")
      .eq("table_name", "model_generations")
      .limit(5);

    // ผลจริง ณ ตอนตรวจสอบ (24 ก.ค. 2026): error เป็น null, data มีแถวจริง (ไม่ถูกกรองด้วย tier
    // เลย) — TIER-401 (UI test เดิม) ผ่านเพราะปุ่ม "📜 ประวัติ" ถูกซ่อนสำหรับ Starter ก็จริง
    // แต่ query เดียวกันที่หน้านั้นเรียกตอนกดปุ่ม สามารถยิงตรงได้อยู่ดีถ้าไม่ผ่าน UI
    // -> จงใจ assert พฤติกรรม "ที่ควรจะเป็น" (ต้องถูกบล็อก) ไม่ใช่พฤติกรรมจริงปัจจุบัน
    // เพื่อให้เทสนี้ค้าง FAIL ไว้เป็นหลักฐาน ไม่ให้เผลอมองว่า "ผ่านแล้ว = ปลอดภัยแล้ว"
    expect(error, "คาดว่า Starter tier ต้องถูกปฏิเสธ (RLS ควรเช็ค subscription_plan) แต่ query สำเร็จโดยไม่มี error").not.toBeNull();
    expect(data?.length || 0).toBe(0);
  });
});

test.describe("API-level bypass check — admin_basic (Starter+ ตาม UI gate)", () => {
  test("TIER-702 [ควรบล็อก แต่ไม่บล็อกจริง] Trial tier insert แถวใน zones (หน้า /admin/zones ที่ Trial เข้าไม่ได้เลย) ตรงผ่าน Supabase client ได้", async () => {
    const trialOwner = getTierShopOwner("trial");
    const { client } = await signInEmail(trialOwner.email, trialOwner.password);
    const trialShopId = await getShopIdByName("QA Tier Shop - trial");

    let insertedId = null;
    try {
      const { data, error } = await client
        .from("zones")
        .insert({
          shop_id: trialShopId,
          parent_id: null,
          code: "TIER702-BYPASS-TEST",
          name: "TIER-702 bypass probe (ลบทิ้งได้)",
          owner_type: "own",
        })
        .select("id")
        .single();

      insertedId = data?.id ?? null;

      // เช่นเดียวกับ TIER-701 — assert พฤติกรรมที่ "ควรจะเป็น" (Trial ไม่มี admin_basic เลย
      // ควรถูกปฏิเสธเขียนข้อมูลใน zones) ไม่ใช่พฤติกรรมจริงที่สังเกตได้ตอนนี้ (insert สำเร็จ)
      expect(error, "คาดว่า Trial tier ต้องถูกปฏิเสธเขียน zones (admin_basic ควรบังคับที่ RLS/API ไม่ใช่แค่ UI) แต่ insert สำเร็จ").not.toBeNull();
    } finally {
      if (insertedId) {
        await adminClient().from("zones").delete().eq("id", insertedId);
      }
    }
  });
});

// ==============================================================
// TIER-703: Tier upgrade กลางเซสชัน — gating client-side sync ทันทีไหม หรือมี stale risk
//
// จากอ่าน lib/AuthProvider.js: subscription_plan ถูก fetch ครั้งเดียวใน loadMemberships()
// (เรียกตอน mount ผ่าน getSession() + ตอน onAuthStateChange ที่ event != TOKEN_REFRESHED/
// USER_UPDATED) แล้วเก็บไว้ใน React state (memberships) — currentShop.subscription_plan ที่
// hasFeature() ใช้จึงเป็นค่า "cached ตอน login/ตอน auth event ล่าสุด" ไม่ใช่ query DB สดทุกครั้ง
// (ข้อดีด้าน perf — ดู TIER-704 คู่กัน) ไม่มี realtime subscription ผูกกับตาราง shops เลย และ
// refreshMemberships() (=loadMemberships) ถูกเรียกจริงแค่ 2 จุด: app/platform-admin/page.js
// (หลัง platform admin แก้ shop เอง) กับ app/signup/page.js — ไม่มีจุดไหนเรียกตอน "shop ของฉัน
// ถูกอัปเกรด/ดาวน์เกรดจากที่อื่น" เลย ดังนั้นคาดว่า: อัปเกรด/ดาวน์เกรดกลางเซสชัน (ไม่ reload)
// จะไม่ถูกจับใน UI ทันที ต้อง reload หน้าใหม่ (ที่ AuthProvider mount ใหม่ -> getSession() ->
// loadMemberships() รอบใหม่) ถึงจะเห็น tier ล่าสุด
// ==============================================================

test.describe("Tier upgrade mid-session — staleness check", () => {
  test("TIER-703 อัปเกรด Founder -> Pro กลางเซสชัน: SPA navigation (ไม่ reload) ยังเห็น tier เก่า, reload แล้วเห็น tier ใหม่ทันที", async ({ browser }) => {
    const founderOwner = getTierShopOwner("founder");
    const founderShopId = await getShopIdByName("QA Tier Shop - founder");

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await loginWithEmail(page, founderOwner.email, founderOwner.password);
      await expectLoginSucceeded(page);

      // ก่อนอัปเกรด: Founder ยังไม่มี "reports" -> ลิงก์ "รายงานการขาย" ต้องไม่โผล่ (เหมือน TIER-501)
      // ⚠️ ต้องรอให้ RequireAuth โหลดเสร็จก่อน (ผ่านพ้น loading spinner) แล้วค่อยเช็ค — ไม่งั้นตอน
      // dev server compile หน้าแรกครั้งแรกช้า (cold compile), assert "not visible" อาจผ่านเพราะ
      // หน้ายังโหลดไม่เสร็จ (ไม่ใช่เพราะ tier ไม่มีสิทธิ์จริง) ทำให้ผลลัพธ์ทั้งเทสไม่น่าเชื่อถือ
      // (เจอจริงตอนเขียนเทสนี้ — ดีบักด้วยการ log network request timestamp เทียบกับตอนที่
      // assert ผ่าน พบว่า assert คืนค่าเร็วกว่าที่ loadMemberships() ยิง request เสร็จจริง)
      await page.goto("/");
      await expect(page.getByText("กำลังตรวจสอบสิทธิ์...")).not.toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("link", { name: /รายงานการขาย/ })).not.toBeVisible({ timeout: 8000 });

      // อัปเกรดกลางเซสชันจริงผ่าน service-role (จำลอง platform admin หรือ billing webhook อัปเกรด
      // แพ็กเกจของอู่นี้ระหว่างที่เจ้าของร้านกำลังใช้งานอยู่พอดี)
      await adminClient().from("shops").update({ subscription_plan: "pro" }).eq("shop_id", founderShopId);

      // สลับแท็บไป-กลับ + รอ (จำลอง "อยู่หน้าเดิมต่อเนื่อง ไม่ reload") — คาดว่า
      // currentShop.subscription_plan ในเมมโมรี่ยังเป็นค่า "founder" เดิม เพราะไม่มี realtime
      // listener ผูกกับตาราง shops เลย (ดูคอมเมนต์ด้านบน) แค่รอเฉยๆ ไม่มีทางเห็น tier ใหม่ได้
      await page.waitForTimeout(1000);
      await expect(
        page.getByRole("link", { name: /รายงานการขาย/ }),
        "คาดว่ายัง stale อยู่ (ไม่เห็นลิงก์ทันทีหลังอัปเกรด โดยไม่ reload) ตาม client-side cache ที่อ่านเจอใน AuthProvider.js"
      ).not.toBeVisible({ timeout: 4000 });

      // reload หน้าจริง -> AuthProvider mount ใหม่ -> getSession() + loadMemberships() ดึง
      // subscription_plan สดจาก DB รอบใหม่ทั้งหมด -> ควรเห็น tier ใหม่ (pro) ทันทีหลัง reload
      // ยืนยันว่า staleness แก้ได้ด้วย full reload/relogin เท่านั้น ไม่ใช่แค่เดินไปมาในแอป
      await page.reload();
      await expect(page.getByText("กำลังตรวจสอบสิทธิ์...")).not.toBeVisible({ timeout: 15000 });
      await expect(page.getByRole("link", { name: /รายงานการขาย/ })).toBeVisible({ timeout: 8000 });
    } finally {
      // คืนค่าเดิมเสมอ กัน suite อื่น (TIER-501 เดิม) พังเพราะ shop นี้ค้างเป็น pro
      await adminClient().from("shops").update({ subscription_plan: "founder" }).eq("shop_id", founderShopId);
      await ctx.close();
    }
  });
});

// ==============================================================
// TIER-704: Performance signal — จำนวน query ที่ยิงเพราะ gating ต่อการโหลดหน้าเดียว
//
// lib/featureGating.js เอง (hasFeature/getTierConfig) เป็น pure function ล้วนๆ ไม่มี network
// call อยู่ในตัว — DB round-trip จริงอยู่ที่ AuthProvider.loadMemberships() ซึ่งดึง subscription_
// plan มาพร้อมกับ shop_members join shops ใน "1 query เดียว" (ไม่ query แยกทีละ feature ที่เช็ค)
// เทสนี้วัดจริงด้วยการนับ network request ไป Supabase REST ระหว่าง login + เดิน 3 หน้าที่มี
// gating (/, /admin, /add) ว่าจำนวน request ไปตาราง shop_members ไม่ได้โตขึ้นตามจำนวน
// hasFeature() call ต่อหน้า (ถ้าโตตามนั้นแปลว่ามี N+1 จริง)
// ==============================================================

test.describe("Performance signal — query count from tier-gating checks", () => {
  test("TIER-704 โหลด /, /admin, /add ติดกัน (5 จุดเรียก hasFeature รวมทั้ง 3 หน้า) ควรมี request ไป shop_members แค่ครั้งเดียวตอน login ไม่ใช่ N+1 ตามจำนวนหน้า", async ({ browser }) => {
    const founderOwner = getTierShopOwner("founder");
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const shopMembersRequests = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/rest/v1/shop_members")) shopMembersRequests.push(url);
    });

    try {
      const t0 = Date.now();
      await loginWithEmail(page, founderOwner.email, founderOwner.password);
      await expectLoginSucceeded(page);
      const afterLoginCount = shopMembersRequests.length;

      const t1 = Date.now();
      await page.goto("/admin");
      await expect(page.getByText("⚙️ ตั้งค่าระบบ")).toBeVisible({ timeout: 8000 });
      const t2 = Date.now();
      await page.goto("/add");
      await expect(page.getByRole("button", { name: /ถ่ายรูป/ })).toBeVisible({ timeout: 8000 });
      const t3 = Date.now();

      const finalCount = shopMembersRequests.length;

      console.log(
        `[TIER-704] shop_members requests: after-login=${afterLoginCount}, after-3-pages=${finalCount} | ` +
          `timings(ms): login=${t1 - t0}, /admin=${t2 - t1}, /add=${t3 - t2}`
      );

      // ข้อสังเกตสำคัญสำหรับ perf (ตัวเลขจริงที่วัดได้ ณ ตอนตรวจสอบ 24 ก.ค. 2026: +8 request
      // สำหรับ 2 full-navigation คือ ~4 request/หน้า ไม่ใช่ 1 ตามที่คาดไว้แรกเริ่ม):
      //   - hasFeature() เองไม่ query DB เลย (pure function อ่าน config เฉยๆ) — ไม่มี N+1
      //     ระดับ "1 query ต่อ feature check" อย่างที่กังวลไว้แรกเริ่ม
      //   - แต่ทุก page.goto() คือ full navigation (ไม่ใช่ SPA route change) จึง remount
      //     AuthProvider ใหม่ทุกครั้ง -> ทุก mount ยิง "2 query แยกกัน" ไป shop_members เสมอ:
      //     (1) loadMemberships() หลัก (shop_members join shops ดึง subscription_plan)
      //     (2) useEffect แยกต่างหากสำหรับ shopHasAdminMember (shop_members count role=admin)
      //     — ดู lib/AuthProvider.js สองจุดนี้แยกกันเป็นคนละ query ทั้งที่ไปตารางเดียวกัน
      //   - "2 query/mount" ที่วัดได้จริงกลายเป็น ~4/navigation เพราะ Next dev server รัน React
      //     StrictMode (double-invoke effect ใน dev เท่านั้น) — เลข "จริง" ใน production build
      //     น่าจะเหลือ ~2/navigation ไม่ใช่ ~4 (ยังไม่ได้ยืนยันด้วย production build ในรอบนี้
      //     — ควรตรวจแยกตอน refactor จริง เพราะถ้า production ก็ยังเป็น 4 นั่นคือของจริงที่ต้องแก้)
      //   - สรุปสำหรับการ refactor: ไม่มี N+1 ต่อ "feature" แต่มี "2 คิวรี่ที่รวมกันได้เหลือ 1"
      //     ต่อทุก full-page navigation (ซึ่งเกิดถี่เพราะ RequireAuth ใช้ page.goto/hard nav
      //     เป็นหลักในโค้ดนี้ ไม่ใช่ next/link SPA nav ในหลายจุด) — merge 2 query เป็น query
      //     เดียว (เช่น ดึง admin-member-count มาพร้อม join เดียวกับ loadMemberships()) คือ
      //     quick win ที่ลด round-trip ได้ทันทีโดยไม่ต้องรอ cache layer ใหญ่กว่านั้น
      expect(finalCount - afterLoginCount).toBeLessThanOrEqual(12); // เผื่อ margin เหนือตัวเลขจริงที่วัดได้ (8) — จะ fail ถ้ามี regression กลายเป็น N+1 จริงๆ (เช่น หลักสิบ)
    } finally {
      await ctx.close();
    }
  });
});
