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

// การ์ด "Multi-branch support" — ตั้งแต่ role ย้ายมาเป็นต่อ (user, branch_id) แทนที่จะเป็นต่อ
// shop เดียว (ดู db/multi_branch_support_migration.sql) 1 user อาจมีหลายแถวใน shop_members
// ของ shop เดียวกันได้แล้ว (คนละสาขา คนละ role) — .maybeSingle() แบบเดิมจะ throw
// ("multiple rows returned") ทันทีที่เจอ user แบบนี้ จึงต้องเปลี่ยนมาดึงทุกแถวแล้วเลือก role
// ที่สิทธิ์สูงสุด (owner/manager ถือว่าสูงสุดเสมอเพราะข้ามทุกสาขาอยู่แล้วตาม is_branch_member())
// ร้านสาขาเดียว (ส่วนใหญ่ 99%+) ยังมีแค่ 1 แถวเหมือนเดิม พฤติกรรมไม่เปลี่ยน
const ROLE_RANK = {
  owner: 6,
  manager: 5,
  admin: 4,
  supervisor: 3,
  technician: 2,
  assistant: 1,
  field_scanner: 1,
};

// คืน role ที่มีสิทธิ์สูงสุดของ user คนนี้ในอู่นี้ (ข้ามทุกสาขาที่มีแถวอยู่) หรือ null ถ้าไม่ใช่สมาชิก active เลย
export async function getCallerShopRole(shopId, userId) {
  const { data: rows, error } = await supabaseAdmin
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;
  if (!rows || rows.length === 0) return null;

  return rows.reduce(
    (best, r) => ((ROLE_RANK[r.role] || 0) > (ROLE_RANK[best] || 0) ? r.role : best),
    rows[0].role
  );
}

// ตรวจว่า userId เป็น owner/manager ของ shopId จริงไหม (ข้ามทุกสาขาของร้านนั้น)
export async function verifyShopManager(shopId, userId) {
  const role = await getCallerShopRole(shopId, userId);

  if (!role || !["owner", "manager"].includes(role)) {
    return { error: "ไม่มีสิทธิ์จัดการทีมของอู่นี้", status: 403 };
  }
  return { ok: true, role };
}

// ตรวจว่า userId เข้าถึง "สาขา" นี้ได้ไหมด้วย role ใดๆ ใน allowedRoles — owner/manager ผ่านเสมอ
// (cross-branch โดยดีไซน์), role อื่นต้องมีแถว shop_members ที่ branch_id ตรงกับสาขานี้จริง
export async function verifyBranchAccess(shopId, branchId, userId, allowedRoles) {
  const { data: rows, error } = await supabaseAdmin
    .from("shop_members")
    .select("role, branch_id")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;

  const match = (rows || []).find(
    (r) =>
      allowedRoles.includes(r.role) &&
      (["owner", "manager"].includes(r.role) || r.branch_id === branchId)
  );

  if (!match) {
    return { error: "ไม่มีสิทธิ์เข้าถึงสาขานี้", status: 403 };
  }
  return { ok: true, role: match.role };
}

// สาขาเดียวที่ user คนนี้มีอยู่ในร้านนี้ ("transparent default" สำหรับร้านสาขาเดียว ซึ่งเป็น
// กรณีส่วนใหญ่ในปัจจุบัน) — คืน null ถ้ามีมากกว่า 1 สาขา (ต้องให้ผู้ใช้เลือกเองผ่าน branch switcher)
// หรือไม่มีเลย (ไม่ใช่สมาชิก active ของร้านนี้)
export async function resolveOnlyBranchId(shopId, userId) {
  const { data: rows, error } = await supabaseAdmin
    .from("shop_members")
    .select("branch_id")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (error) throw error;

  const distinctBranches = [...new Set((rows || []).map((r) => r.branch_id))];
  return distinctBranches.length === 1 ? distinctBranches[0] : null;
}

// เช็คว่าจำนวนสาขา (active) เกิน tier.maxBranches หรือยัง — คู่กับ fn_tier_max_branches()/
// trg_branches_tier_limit ฝั่ง DB ใน db/multi_branch_support_migration.sql (defense in depth,
// เลข 2 ที่ต้อง sync กัน เหมือน pattern เดียวกับ stockValueCap/fn_tier_stock_cap ที่มีอยู่แล้ว)
export async function checkBranchLimit(shopId) {
  const { data: shop, error: shopError } = await supabaseAdmin
    .from("shops")
    .select("subscription_plan, shop_name")
    .eq("shop_id", shopId)
    .single();
  if (shopError) throw shopError;

  const tier = getTierConfig(shop.subscription_plan);

  if (isUnlimited(tier.maxBranches)) {
    return { ok: true, shop, tier };
  }

  const { count, error: countError } = await supabaseAdmin
    .from("branches")
    .select("branch_id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .eq("is_active", true);
  if (countError) throw countError;

  if ((count || 0) >= tier.maxBranches) {
    return {
      ok: false,
      error: `จำนวนสาขาถึงขีดจำกัดของแพ็กเกจ ${tier.label} แล้ว (สูงสุด ${tier.maxBranches} สาขา) — อัปเกรดแพ็กเกจเพื่อเพิ่มสาขาได้`,
    };
  }

  return { ok: true, shop, tier };
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
