import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { concurrentAccounts } from "../fixtures/test-data.js";
import { getAccessToken, getStoredSessionId } from "../fixtures/api-helpers.js";
import { GLOBAL_SESSION_CONFIG } from "../../config/subscriptionTiers.js";

// registerSession() ถูกเรียกจาก useEffect ฝั่ง client หลัง redirect สำเร็จ (ไม่ sync กับ
// expectLoginSucceeded ที่เช็คแค่ URL) — ตอนรันแบบ 5 worker พร้อมกัน CPU โหลดหนักขึ้นทำให้
// เห็น race condition นี้ชัดขึ้น (เจอจริง 22 ก.ค. 2026: คาดหวัง 3 session แต่เจอแค่ 2 ตอน
// query เร็วเกินไป) แก้ด้วยการ poll รอจนกว่าจำนวนจะตรงเป้าจริง แทนที่จะเช็คครั้งเดียวทันที
async function pollSessionCount(filter, expectedCount, { timeoutMs = 5000, intervalMs = 300 } = {}) {
  const [column, value] = typeof filter === "object" ? Object.entries(filter)[0] : ["shop_id", filter];
  const deadline = Date.now() + timeoutMs;
  let rows = [];
  while (Date.now() < deadline) {
    const { data } = await adminClient().from("user_sessions").select("session_id, user_id, last_seen_at").eq(column, value);
    rows = data || [];
    if (rows.length === expectedCount) return rows;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return rows; // คืนค่าล่าสุดแม้ไม่ตรง — ให้ expect ด้านนอก fail แบบเห็น diff จริง ไม่ใช่ throw ที่นี่
}

// TC-302a/b ใช้ shop เดียวกัน ("QA Concurrent-Session Shop (auto)") ที่ตั้งใจ share
// กันข้าม test ในไฟล์นี้ — ถ้ารันแบบ fullyParallel (workers>1) 2 test นี้อาจถูกส่งไปคนละ
// worker แล้วรันพร้อมกันจริง ทำให้ session count ของ shop เดียวกันชนกันเอง (เจอจริง
// 22 ก.ค. 2026 ตอนเปิด parallel ครั้งแรก — TC-302b คาดหวัง 2 session แต่ได้ 3 เพราะ
// TC-302a ที่รันพร้อมกันดันเพิ่ม session เข้ามาแทรก) บังคับ serial เฉพาะไฟล์นี้กันไว้เลย
// ไม่ต้องพึ่งว่า Playwright จะจัดคิวให้บังเอิญไม่ชนกัน
test.describe.configure({ mode: "serial" });

// ------------------------------------------------------------
// TC-302: lib/sessionTracking.js + lib/AuthProvider.js
// ต้องใช้ browser context จริง (ไม่ใช่ direct API) เพราะ registerSession() ถูกเรียกจาก
// useEffect ฝั่ง client หลัง login สำเร็จเท่านั้น ไม่มี server-side trigger ใดๆ
//
// ใช้ shop เฉพาะ "QA Concurrent-Session Shop (auto)" ที่ตั้ง plan='trial' ไว้ตั้งใจ
// (maxConcurrentSessions: 3, maxMembers: 3 — ดู config/subscriptionTiers.js)
// ------------------------------------------------------------

let concurrentShopId;

test.beforeAll(async () => {
  concurrentShopId = await getShopIdByName("QA Concurrent-Session Shop (auto)");
  // เคลียร์ user_sessions ของ shop นี้ให้ว่างก่อนเริ่ม กันผลตกค้างจากรอบก่อน
  await adminClient().from("user_sessions").delete().eq("shop_id", concurrentShopId);
});

test("TC-302a คนที่ 4 (distinct user) login พร้อมกันในอู่ที่ tier=trial (cap=3) ต้องโดน force sign-out ทันที", async ({
  browser,
}) => {
  const contexts = [];
  try {
    // login 3 คนแรก — ทั้งหมดต้องสำเร็จปกติ ไม่มีใครโดนเตะ
    for (let i = 0; i < 3; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginWithEmail(page, concurrentAccounts[i].email, concurrentAccounts[i].password);
      await expectLoginSucceeded(page);
      contexts.push(ctx);
    }

    // ยืนยันด้วย service role ว่ามี user_sessions ครบ 3 แถวสำหรับ shop นี้แล้ว
    const before = await pollSessionCount({ shop_id: concurrentShopId }, 3);
    expect(before?.length).toBe(3);

    // คนที่ 4 (distinct user คนใหม่) login เข้าอู่เดียวกัน -> ต้องโดน signOut อัตโนมัติ
    // (ดู lib/AuthProvider.js: ถ้า registerSession().ok===false จะเรียก supabase.auth.signOut()
    // ทันทีแล้ว RequireAuth เห็น session===null จึง redirect กลับ /login)
    const ctx4 = await browser.newContext();
    const page4 = await ctx4.newPage();
    await loginWithEmail(page4, concurrentAccounts[3].email, concurrentAccounts[3].password);
    await expect(page4).toHaveURL(/\/login/, { timeout: 10000 });
    contexts.push(ctx4);

    // ยืนยันว่าคนที่ 4 ไม่ถูกนับเข้า user_sessions เลย (ยังคงมีแค่ 3 แถวเท่าเดิม)
    const after = await pollSessionCount({ shop_id: concurrentShopId }, 3);
    expect(after?.length).toBe(3);

    // ⚠️ ข้อสังเกตสำคัญ: sessionError (ข้อความ "อู่นี้มีคนใช้งานพร้อมกันเต็มแล้ว...")
    // ถูก set ไว้ใน AuthProvider context จริง แต่ "ไม่มีที่ไหนใน UI render sessionError เลย"
    // (grep แล้วทั้ง codebase มีแค่จุด setSessionError/state เฉยๆ ไม่มี component ไหน .sessionError)
    // ผู้ใช้คนที่ 4 จะแค่เห็นหน้า /login โผล่มาเฉยๆ โดยไม่รู้เหตุผลเลยว่าทำไม login "สำเร็จ"
    // (กรอก email/password ถูก ไม่มี error message ตอนกรอกฟอร์มด้วยซ้ำ) แต่ดันเด้งกลับมาที่เดิม
    // แนะนำทีม dev ให้ render sessionError เป็น toast/banner บนหน้า /login ตอน redirect กลับมา
  } finally {
    for (const ctx of contexts) await ctx.close();
  }
});

test(`TC-302b user เดิม login เครื่องที่ ${GLOBAL_SESSION_CONFIG.maxDevicesPerUser + 1} (เกิน maxDevicesPerUser=${GLOBAL_SESSION_CONFIG.maxDevicesPerUser}) ไม่ถูกบล็อก แค่ evict session เก่าสุด — และตอนนี้อุปกรณ์ที่ถูกเขี่ยต้องโดน API ปฏิเสธจริงด้วย (ไม่ใช่แค่ signOut ที่ไม่มีใครเห็น)`, async ({
  browser,
  request,
  baseURL,
}) => {
  const targetUser = concurrentAccounts[0];
  const maxDevices = GLOBAL_SESSION_CONFIG.maxDevicesPerUser; // ดึงจาก config ตรงๆ แทนการ hardcode
  // เจอมาแล้วว่าค่านี้เปลี่ยนจาก 2 -> 4 ระหว่างทาง (ดู git log config/subscriptionTiers.js) ทำให้
  // เทสต์เดิมที่ hardcode "login 2 เครื่องแล้วเครื่องที่ 3 evict" เพี้ยนไปจาก config จริงเงียบๆ
  // โดยไม่มีใครสังเกต — ผูกกับ config ตรงนี้กันไม่ให้เกิดซ้ำ

  // เคลียร์ user_sessions ของ user นี้ก่อน (กัน state ค้างจาก TC-302a หรือรอบก่อนหน้า)
  const { data: existingUser } = await adminClient().auth.admin.listUsers({ page: 1, perPage: 200 });
  const authUser = existingUser.users.find((u) => u.email === targetUser.email);
  await adminClient().from("user_sessions").delete().eq("user_id", authUser.id);

  const contexts = [];
  try {
    // login "อุปกรณ์" ที่ 1..maxDevices — ต้องผ่านทั้งหมดตามปกติ (พอดี cap ยังไม่ล้น)
    for (let i = 0; i < maxDevices; i++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await loginWithEmail(page, targetUser.email, targetUser.password);
      await expectLoginSucceeded(page);
      contexts.push({ ctx, page });
      await page.waitForTimeout(1500); // กัน last_seen_at ชนกันเป๊ะจนเรียงลำดับผิด (เพิ่มจาก 500ms
      // เดิม 22 ก.ค. 2026 — ตอนรันภายใต้ 5 worker parallel พร้อมกัน CPU โหลดหนักขึ้นทำให้ 500ms
      // ไม่พอเป็น margin อีกต่อไป last_seen_at ของ 2 session เรียงลำดับผิดเป็นบางครั้ง)
    }

    const afterFull = await pollSessionCount({ user_id: authUser.id }, maxDevices);
    expect(afterFull?.length).toBe(maxDevices);
    // สำคัญ: ต้อง sort ตาม last_seen_at ให้ตรงกับ lib/sessionTracking.js ที่ query จริง
    // (.order("last_seen_at", { ascending: true })) ไม่ใช่ sort ตาม session_id เดิม —
    // เจอบั๊กจริง 22 ก.ค. 2026: session_id เรียงตามลำดับ insert ก็จริง แต่ last_seen_at
    // อาจไม่ตรงกัน ถ้ามี heartbeat ของ context เก่าที่ยังเปิดค้างอยู่ (ไม่ได้ปิด) อัปเดต
    // last_seen_at แทรกเข้ามาระหว่างที่ setup context ถัดไป
    const sortedByAge = afterFull.slice().sort((a, b) => new Date(a.last_seen_at) - new Date(b.last_seen_at));
    const oldestSessionId = sortedByAge[0].session_id;
    const oldestContextIndex = 0; // login เข้าตามลำดับ 0..maxDevices-1 -> contexts[0] คือเก่าสุดเสมอ

    // เก็บ token + session_id ของ "อุปกรณ์เก่าสุด" ไว้ก่อนมันจะถูกเขี่ย — ต้องใช้ยืนยัน API
    // rejection ด้านล่างหลัง evict แล้ว (เอาตอนนี้เพราะหลัง evict แถวหายไปแล้ว แต่ token/sessionId
    // ที่ฝั่ง client "จำ" ไว้ยังเหมือนเดิม เป็นสิ่งที่เทสต์ต้องพิสูจน์ว่ามันใช้ไม่ได้อีกต่อไป)
    const oldestAccessToken = await getAccessToken(contexts[oldestContextIndex].page);
    const oldestSessionIdFromClient = await getStoredSessionId(contexts[oldestContextIndex].page);
    expect(oldestAccessToken).toBeTruthy();
    expect(oldestSessionIdFromClient).toBe(oldestSessionId); // sanity check: DB กับ client ตรงกัน

    // login "อุปกรณ์" ตัวที่ maxDevices+1 — คาดว่า "ไม่ถูกบล็อก" (ต่างจาก TC-302a ที่บล็อกที่ shop-level)
    const ctxExtra = await browser.newContext();
    const pageExtra = await ctxExtra.newPage();
    await loginWithEmail(pageExtra, targetUser.email, targetUser.password);
    await expectLoginSucceeded(pageExtra); // คาดว่าผ่าน ไม่ redirect กลับ /login
    contexts.push({ ctx: ctxExtra, page: pageExtra });

    // ยืนยันว่า "จำนวนแถว" ยังคงเป็น maxDevices (ตัดของเก่าสุดทิ้งไปแล้ว ไม่ใช่เพิ่มขึ้น)
    const afterEvict = await pollSessionCount({ user_id: authUser.id }, maxDevices);
    expect(afterEvict?.length).toBe(maxDevices);
    const remainingIds = afterEvict.map((r) => r.session_id);
    expect(remainingIds).not.toContain(oldestSessionId); // แถวเก่าสุดถูกลบไปแล้วจริง

    // ⚠️ ข้อสังเกตสำคัญที่ 2 (ประวัติเดิมก่อน fix): การ "evict" นี้แค่ลบแถวใน user_sessions
    // (bookkeeping table) ไม่ได้เรียก supabase.auth.signOut() ให้อุปกรณ์เก่าสุดทันที — โทเค็น
    // auth ของอุปกรณ์นั้นยัง valid ตาม Supabase Auth เองทุกประการ (จะยังไม่ redirect ไป /login
    // ทันทีที่ reload เพราะ RequireAuth เช็คแค่ session Supabase ว่ามีอยู่ไหม ไม่ได้เช็ค
    // user_sessions ด้วย — การ signOut อัตโนมัติจริงเกิดจาก heartbeat ทุก 60 วิใน
    // lib/AuthProvider.js ซึ่งช้ากว่า "ทันที" — ดู lib/sessionTracking.js heartbeatSession()
    // สำหรับเหตุผลที่เลือก client-side heartbeat แทน server-side middleware)
    await contexts[oldestContextIndex].page.reload();
    await expect(contexts[oldestContextIndex].page).not.toHaveURL(/\/login/, { timeout: 5000 });

    // ✅ นี่คือส่วนที่แก้จริงในการ์ดนี้ ("Concurrent session eviction ไม่ invalidate JWT จริง"):
    // แม้ token ยัง valid และหน้าเว็บยัง reloadได้ปกติ (ด้านบน) แต่ API route ที่ผ่าน
    // lib/teamAuth.js verifyCaller() ต้องปฏิเสธอุปกรณ์นี้ทันทีแล้ว เพราะตอนนี้ verifyCaller()
    // เช็คเพิ่มว่าแถว user_sessions ของ user_id+session_id คู่นี้ยังอยู่จริงไหม (ไม่ใช่แค่เช็ค
    // JWT validity เฉยๆ เหมือนเดิม) — ยิง request ตรงด้วย token+session_id เก่าของอุปกรณ์ที่ถูก
    // เขี่ยไปแล้ว ต้องได้ 401 พร้อมข้อความอธิบายชัดเจน ไม่ใช่ 200 เหมือนก่อน fix
    // shop_id ที่ส่งไปแค่ต้องเป็น UUID ที่มีอยู่จริง — verifyCaller() ปฏิเสธก่อนถึง shop
    // membership check เสมอ (ดู app/api/team/list-with-emails/route.js ลำดับ check) ใช้
    // concurrentShopId ของไฟล์นี้เองไม่ต้องไปหา shop อื่นมาเพิ่ม
    const res = await request.post(`${baseURL}/api/team/list-with-emails`, {
      headers: {
        Authorization: `Bearer ${oldestAccessToken}`,
        "x-session-id": oldestSessionIdFromClient,
      },
      data: { shop_id: concurrentShopId },
    });

    expect(res.status()).toBe(401);
    const json = await res.json();
    expect(json.error).toContain("ถูกยกเลิกจากอุปกรณ์อื่น");
  } finally {
    for (const { ctx } of contexts) await ctx.close();
  }
});
