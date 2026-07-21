import { supabase } from "./supabaseClient";
import { GLOBAL_SESSION_CONFIG, getTierConfig } from "../config/subscriptionTiers";

/**
 * เรียกครั้งเดียวหลัง login + เลือก shop สำเร็จ
 * คืนค่า { ok: true, sessionId } หรือ { ok: false, reason }
 */
export async function registerSession(userId, shopId, subscriptionPlan) {
  const tier = getTierConfig(subscriptionPlan);

  // 0) เก็บกวาด session ที่ "ตายจริง" ทิ้งก่อนนับอะไรทั้งสิ้น
  // เหตุผล: releaseSession() พึ่งพา event beforeunload ซึ่งไม่ fire เสมอ (ปิดแอปเบราว์เซอร์บนมือถือ,
  // เน็ตหลุด, force-quit, บางเบราว์เซอร์ตอนปิดแท็บ) แถวที่ค้างแบบนี้จะไปกิน slot ของ
  // concurrent session limit อย่างผิด ๆ ทั้งที่ไม่มีใครใช้งานจริงแล้ว จึงต้องเคลียร์ด้วย
  // last_seen_at staleness ทุกครั้งก่อนนับ (แทนที่จะพึ่ง release ฝั่ง client อย่างเดียว)
  const staleBeforeIso = new Date(
    Date.now() - GLOBAL_SESSION_CONFIG.sessionStaleAfterMinutes * 60 * 1000
  ).toISOString();
  await supabase.from("user_sessions").delete().lt("last_seen_at", staleBeforeIso);

  // 1) เช็คจำนวนเครื่องที่ user คนนี้ login อยู่ (ทุก shop รวมกัน) — แถวที่เหลือหลังขั้นตอน 0
  //    คือ session ที่ยัง active จริงเท่านั้น
  const { data: myDeviceSessions } = await supabase
    .from("user_sessions")
    .select("session_id, last_seen_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: true });

  if (myDeviceSessions && myDeviceSessions.length >= GLOBAL_SESSION_CONFIG.maxDevicesPerUser) {
    // ลบ session เก่าสุดออกก่อน (force logout เครื่องเก่าอัตโนมัติ)
    const toRemove = myDeviceSessions.slice(
      0,
      myDeviceSessions.length - GLOBAL_SESSION_CONFIG.maxDevicesPerUser + 1
    );
    await supabase
      .from("user_sessions")
      .delete()
      .in("session_id", toRemove.map((s) => s.session_id));
  }

  // 1.5) การ์ด "Onboarding Burst Mode" — field_scanner (บัญชีชั่วคราว Burst Mode) ไม่นับใน
  // concurrent cap ปกติเลย ทั้ง "ตัวเองถูกนับ" และ "ไปเบียดโควตาคนอื่น" ("login field scanner
  // 20 คน ไม่กระทบ session ของ staff ปกติ" ตามการ์ด) — เช็ค role ของตัวเองก่อน ถ้าเป็น field_scanner
  // ข้ามการเช็ค concurrent cap ทั้งหมดในขั้นตอนนี้ไปเลย
  const { data: myMembership } = await supabase
    .from("shop_members")
    .select("role")
    .eq("shop_id", shopId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  const isFieldScanner = myMembership?.role === "field_scanner";

  // 2) เช็คจำนวนคน (distinct user) ที่ login พร้อมกันทั้งอู่ (ไม่นับ user นี้ที่กำลังจะเข้าเอง)
  //    หลังขั้นตอน 0 แล้ว แถวที่เหลือคือ session ที่ยัง active จริงเท่านั้น ไม่ใช่ session ผี
  if (!isFieldScanner && tier.maxConcurrentSessions !== null && tier.maxConcurrentSessions !== undefined) {
    const [{ data: shopSessions }, { data: shopMembers }] = await Promise.all([
      supabase.from("user_sessions").select("user_id").eq("shop_id", shopId),
      supabase.from("shop_members").select("user_id, role").eq("shop_id", shopId).eq("role", "field_scanner"),
    ]);

    const fieldScannerUserIds = new Set((shopMembers || []).map((m) => m.user_id));
    const distinctUsers = new Set(
      (shopSessions || []).map((s) => s.user_id).filter((uid) => !fieldScannerUserIds.has(uid))
    );
    distinctUsers.delete(userId); // ตัวเองไม่นับซ้ำ (ถ้าเคยมี session อยู่แล้วจาก step 1)

    if (distinctUsers.size >= tier.maxConcurrentSessions) {
      return {
        ok: false,
        reason: `อู่นี้มีคนใช้งานพร้อมกันเต็มแล้ว (${distinctUsers.size}/${tier.maxConcurrentSessions} ตาม tier ${tier.label}) กรุณาลองใหม่อีกครั้ง หรืออัปเกรดแพ็กเกจ`,
      };
    }
  }

  // 3) บันทึก session ใหม่
  const deviceLabel =
    typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : "unknown device";

  const { data: inserted, error } = await supabase
    .from("user_sessions")
    .insert({ user_id: userId, shop_id: shopId, device_label: deviceLabel })
    .select()
    .single();

  if (error) return { ok: false, reason: error.message };

  return { ok: true, sessionId: inserted.session_id };
}

export async function heartbeatSession(sessionId) {
  if (!sessionId) return;
  await supabase
    .from("user_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("session_id", sessionId);
}

export async function releaseSession(sessionId) {
  if (!sessionId) return;
  await supabase.from("user_sessions").delete().eq("session_id", sessionId);
}
