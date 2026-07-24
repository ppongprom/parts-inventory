// ------------------------------------------------------------
// Helper สำหรับเทสต์ที่ต้องยิง API ตรง (ไม่ผ่าน UI) เช่น TC-205, TC-404
// ต้องดึง Supabase access token จาก session ที่ login ผ่าน UI ไว้แล้ว
// เพราะ API routes พวกนี้เช็คจาก Authorization: Bearer header ไม่ใช่ cookie
// ------------------------------------------------------------

/** ดึง access_token ของ session ปัจจุบันจาก localStorage ของ Supabase client */
export async function getAccessToken(page) {
  return await page.evaluate(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("sb-") && key.endsWith("-auth-token")) {
        try {
          const parsed = JSON.parse(window.localStorage.getItem(key));
          return parsed?.access_token || parsed?.currentSession?.access_token || null;
        } catch {
          continue;
        }
      }
    }
    return null;
  });
}

/** ดึง session_id ปัจจุบัน (การ์ด "Concurrent session eviction ไม่ invalidate JWT จริง") จาก
 *  sessionStorage — ดู lib/sessionTracking.js getStoredSessionId()/SESSION_ID_HEADER สำหรับ
 *  ที่มา ค่านี้แนบไปกับทุก API call ที่ผ่าน lib/teamAuth.js verifyCaller() เป็น header x-session-id
 *  เพื่อให้ server เช็คได้ว่าแถวใน user_sessions ของ session นี้ยังอยู่จริงไหมก่อนเชื่อ JWT */
export async function getStoredSessionId(page) {
  return await page.evaluate(() => window.sessionStorage.getItem("pi_session_id"));
}

/**
 * เข้า /admin/team แล้วดัก request ที่แอปยิงไป /api/team/list-with-emails เอง
 * เพื่อดึง shop_id (ไม่ต้อง hardcode) และรายชื่อสมาชิกทั้งหมดของอู่นั้น
 * คืนค่า { shopId, members } — members คือ array จาก response.data
 */
export async function captureTeamPageData(page) {
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("/api/team/list-with-emails") && res.request().method() === "POST"
  );
  await page.goto("/admin/team");
  const response = await responsePromise;

  const requestBody = JSON.parse(response.request().postData() || "{}");
  const json = await response.json();

  return {
    shopId: requestBody.shop_id,
    members: json.data || [],
  };
}

export function findMemberByUsername(members, username) {
  return members.find((m) => m.login_username === username);
}
