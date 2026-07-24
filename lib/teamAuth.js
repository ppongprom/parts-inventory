import { supabaseAdmin } from "./supabaseAdminClient";
import { getTierConfig, isUnlimited } from "../config/subscriptionTiers";

// ต้องตรงกับ SESSION_ID_HEADER ใน lib/sessionTracking.js เป๊ะ (ไม่ import ตรงๆ ข้ามมาจากไฟล์
// นั้น เพราะไฟล์นั้น import lib/supabaseClient.js ซึ่งเป็น browser client — ไม่อยากดึงเข้ามาใน
// bundle ฝั่ง server โดยไม่จำเป็น ค่านี้เป็นแค่ชื่อ header คงที่ ไม่มี logic ที่ต้อง share จริง)
const SESSION_ID_HEADER = "x-session-id";

// ตรวจ Bearer token ว่า login อยู่จริงไหม คืน { userId } หรือ { error, status }
//
// การ์ด "Concurrent session eviction ไม่ invalidate JWT จริง (OWASP A07 gap)" — approach 2:
// เดิม verifyCaller() เช็คแค่ว่า JWT ยัง valid ตาม Supabase Auth เอง ซึ่งไม่ได้แปลว่า session
// นี้ "ยังไม่โดนเขี่ยจาก concurrent-session cap" — eviction เดิม (ดู lib/sessionTracking.js
// registerSession) แค่ลบแถวใน user_sessions ทิ้ง ไม่ได้ revoke JWT จริง (Supabase ไม่มี API
// เพิกถอน access token รายตัวแบบทันที ไม่รื้อระบบ auth hook ใหม่ทั้งชุด) ดังนั้นเครื่องที่ถูก
// เขี่ยยังเรียก API พวกนี้ผ่านได้เรื่อยๆ จนกว่า JWT จะหมดอายุเองถ้าไม่เช็คเพิ่ม
//
// จึงเพิ่มเช็คตรงนี้: ถ้า client ส่ง header x-session-id มา (แอปฝั่ง client อัปเดตให้ส่งมาแล้ว
// ทุกจุดที่เรียก API เหล่านี้ — ดู lib/sessionTracking.js getStoredSessionId()) ให้ยืนยันว่าแถว
// user_sessions ของ user_id+session_id คู่นี้ยังอยู่จริง ก่อนจะเชื่อ userId จาก JWT ต่อ
//
// ⚠️ ถ้าไม่มี header นี้มาเลย (caller เก่า/เทสต์ที่ยิง API ตรงๆ โดยไม่รู้จัก mechanism นี้ เช่น
// qa-automation/tests/api-rbac.spec.js TC-205a/b/c) จะข้ามเช็คนี้ไป เหลือแค่ JWT validity เหมือน
// เดิม — ไม่ทำให้ caller ที่ไม่มี concept ของ session_id (เช่น service-to-service ในอนาคต)
// พังไปด้วย เป็น trade-off ที่ยอมรับได้เพราะ endpoint กลุ่มนี้ (team mgmt/export/platform-admin)
// ทุกจุดที่เรียกจริงจาก UI ผ่าน AuthProvider ซึ่งตั้ง session_id ไว้เสมอหลัง login สำเร็จ
//
// ⚠️ Performance trade-off ที่ตั้งใจ ไม่ใช่ของหลุดมือ: เพิ่ม DB lookup 1 ครั้งต่อ request ที่มี
// session_id header (query .eq().eq().maybeSingle() แบบเดียวกับที่ใช้ทั่วโค้ดนี้ เช่น
// verifyShopManager ด้านล่าง) แอปนี้เป็นระบบ B2B/admin ปริมาณ request ต่ำ ไม่ใช่ high-frequency
// trading จึงไม่คุ้มที่จะทำ caching เพิ่มความซับซ้อนเพื่อประหยัด query เดียวนี้
export async function verifyCaller(request) {
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) return { error: "ไม่พบ token กรุณาเข้าสู่ระบบใหม่", status: 401 };

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData?.user) {
    return { error: "session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่", status: 401 };
  }
  const userId = userData.user.id;

  const sessionId = (request.headers.get(SESSION_ID_HEADER) || "").trim();
  if (sessionId) {
    const { data: sessionRow } = await supabaseAdmin
      .from("user_sessions")
      .select("session_id")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .maybeSingle();

    if (!sessionRow) {
      return {
        error: "session ถูกยกเลิกจากอุปกรณ์อื่น กรุณาเข้าสู่ระบบใหม่",
        status: 401,
      };
    }
  }

  return { userId };
}

// ตรวจว่า userId เป็น owner/manager ของ shopId จริงไหม
export async function verifyShopManager(shopId, userId) {
  const { data: callerMember } = await supabaseAdmin
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();

  if (!callerMember || !["owner", "manager"].includes(callerMember.role)) {
    return { error: "ไม่มีสิทธิ์จัดการทีมของอู่นี้", status: 403 };
  }
  return { ok: true, role: callerMember.role };
}

// เช็คว่าที่นั่ง (สมาชิก active + คำเชิญค้าง) เกิน tier.maxMembers หรือยัง
// excludeEmail: กันไม่ให้นับคำเชิญของอีเมลเดียวกันซ้ำตอน re-invite
export async function checkSeatLimit(shopId, excludeEmail = null) {
  const { data: shop, error: shopError } = await supabaseAdmin
    .from("shops")
    .select("subscription_plan, shop_name")
    .eq("shop_id", shopId)
    .single();
  if (shopError) throw shopError;

  const tier = getTierConfig(shop.subscription_plan);

  if (isUnlimited(tier.maxMembers)) {
    return { ok: true, shop, tier };
  }

  let inviteQuery = supabaseAdmin
    .from("shop_invites")
    .select("invite_id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .is("accepted_at", null);
  if (excludeEmail) inviteQuery = inviteQuery.neq("email", excludeEmail);

  const [{ count: activeCount }, { count: pendingCount }] = await Promise.all([
    supabaseAdmin
      .from("shop_members")
      .select("member_id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("status", "active"),
    inviteQuery,
  ]);

  const total = (activeCount || 0) + (pendingCount || 0);
  if (total >= tier.maxMembers) {
    return {
      ok: false,
      error: `จำนวนสมาชิก/คำเชิญค้างถึงขีดจำกัดของแพ็กเกจ ${tier.label} แล้ว (สูงสุด ${tier.maxMembers} คน) — อัปเกรดแพ็กเกจเพื่อเพิ่มคนได้`,
    };
  }

  return { ok: true, shop, tier };
}
