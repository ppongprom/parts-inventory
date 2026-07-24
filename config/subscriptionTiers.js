/**
 * Subscription tier configuration
 * ------------------------------------------------------------
 * แก้ตัวเลขในไฟล์นี้ไฟล์เดียว เพื่อปรับราคา/limit ของแต่ละ tier
 * โดยไม่ต้องไปตามแก้โค้ดที่ใช้งานจริงในหลายจุด (single source of truth)
 *
 * maxMembers            = จำนวนคนที่เชิญเข้าอู่ได้สูงสุด (roster cap)
 * maxConcurrentSessions = จำนวนคน login ใช้งานพร้อมกันได้สูงสุด ณ เวลาเดียวกัน
 * maxDevicesPerUser     = 1 คนใช้ login พร้อมกันได้กี่เครื่อง (ทุก tier เท่ากัน
 *                         เป็นค่า global ป้องกันการแชร์ account เดียวหลายเครื่องเกินจำเป็น)
 * priceMonthly / priceYearly = หน่วยเป็นบาท, null = ติดต่อฝ่ายขาย (Enterprise)
 * stockValueCap = การ์ด "Stock Value Cap Engine" — มูลค่าสต็อกสูงสุด (บาท) ก่อนเข้า grace period
 *                 null = ไม่จำกัด (Enterprise) — ✅ ตัวเลขตัดสินใจชั่วคราวแล้วในการ์ด
 *                 ⚠️ ตัวเลขชุดนี้ซ้ำอยู่ใน db/stock_value_cap_engine_migration.sql
 *                 (fn_tier_stock_cap) ด้วย เพราะ trigger ฝั่ง DB ต้องรู้ cap ทันทีตอนแก้ parts
 *                 โดยไม่พึ่งแอปเรียก RPC แยก — แก้ที่นี่แล้วต้องไปแก้ SQL function ให้ตรงกันด้วย
 *                 (ดูหมายเหตุเต็มในไฟล์ migration ว่าทำไมถึงต้องมี 2 ที่)
 * burstModeMaxAccounts = การ์ด "Onboarding Burst Mode" — จำนวนบัญชี field_scanner ชั่วคราว
 *                 (Burst Mode) สูงสุดต่ออู่ ไม่ผูกกับ maxMembers ปกติ — ✅ ตัดสินใจแล้วในการ์ด
 *                 (21 ก.ค. 2026): "20 บัญชี fix ทุก tier ยกเว้น Enterprise ที่ configurable" —
 *                 null = configurable/เจรจาต่อรายอู่ (ตาม convention เดียวกับ maxMembers/
 *                 maxConcurrentSessions ของ Enterprise ในไฟล์นี้ — ไม่มี UI ตั้งค่าต่อร้านแยกต่างหาก
 *                 ตอนนี้ ถ้าต้องการค่าที่ตั้งได้จริงต้องเพิ่มคอลัมน์ shops.burst_mode_max_accounts
 *                 override ในอนาคต — เพิ่มเมื่อมีลูกค้า Enterprise จริงที่ต้องการปรับ)
 * maxBranches = การ์ด "Multi-branch support (Pro=2 สาขา, Enterprise=ไม่จำกัด)" — จำนวนสาขาสูงสุด
 *                 ต่อร้าน (นับเฉพาะสาขา active) ✅ ตัดสินใจแล้วในการ์ด: Starter/Founder = 1 (สร้าง
 *                 สาขาเพิ่มไม่ได้เลย), Pro = 2, Enterprise = null (ไม่จำกัด). Trial ไม่ได้ระบุตรงๆ
 *                 ในการ์ด — judgment call: ให้เท่า Starter/Founder (1 สาขา)
 *                 ⚠️ ตัวเลขชุดนี้ซ้ำอยู่ใน db/multi_branch_support_migration.sql
 *                 (fn_tier_max_branches) ด้วย เพราะ trigger ฝั่ง DB (trg_branches_tier_limit)
 *                 ต้องรู้ limit ทันทีตอน insert branches โดยไม่พึ่งแอปเรียก RPC แยก — แก้ที่นี่แล้ว
 *                 ต้องไปแก้ SQL function ให้ตรงกันด้วย (เหมือน pattern stockValueCap ด้านบน)
 */

export const GLOBAL_SESSION_CONFIG = {
  maxDevicesPerUser: 4,
  idleTimeoutMinutes: 360,        // ไม่มีกิจกรรมเกินเท่านี้ -> เริ่มนับถอยหลัง
  idleWarningCountdownSeconds: 603, // เวลานับถอยหลังก่อน logout อัตโนมัติ
  sessionStaleAfterMinutes: 3, // แถวใน user_sessions ที่ last_seen_at เก่ากว่านี้ถือว่าเป็น
                                // "session ผี" (ปิดแท็บ/แอปมือถือ/เน็ตหลุดโดยไม่ผ่าน beforeunload)
                                // ไม่นับใน concurrent session limit และถูกเก็บกวาดทิ้งอัตโนมัติ
                                // (heartbeat ทุก 60 วิ ค่านี้เผื่อพลาดได้ ~2-3 รอบก่อนถือว่าหลุดจริง)
};

export const SUBSCRIPTION_TIERS = {
  trial: {
    label: "Trial",
    priceMonthly: 0,
    priceYearly: 0,
    maxMembers: 3,
    maxConcurrentSessions: 3,
    stockValueCap: 500000,
    maxParts: 50,
    burstModeMaxAccounts: 20,
    trialDays: 14,
    maxBranches: 1,
    features: ["core_crud", "search", "mobile_camera"],
  },
  starter: {
    label: "Starter",
    priceMonthly: 399,
    priceYearly: 4000,
    maxMembers: 5,
    maxConcurrentSessions: 5,
    stockValueCap: 1000000,
    maxParts: null, // ไม่จำกัด
    burstModeMaxAccounts: 20,
    maxBranches: 1,
    features: ["core_crud", "search", "mobile_camera", "admin_basic"],
  },
  founder: {
    label: "Founder",
    priceMonthly: 649,
    priceYearly: 6500,
    maxMembers: 10,
    maxConcurrentSessions: 8,
    stockValueCap: 3000000,
    maxParts: null,
    burstModeMaxAccounts: 20,
    maxBranches: 1,
    features: [
      "core_crud",
      "search",
      "mobile_camera",
      "admin_basic",
      "audit_log",
      "gallery_view",
      "multi_photo",
    ],
  },
  pro: {
    label: "Pro",
    priceMonthly: 899,
    priceYearly: 9000,
    maxMembers: 15,
    maxConcurrentSessions: 12,
    stockValueCap: 10000000,
    maxParts: null,
    burstModeMaxAccounts: 20,
    maxBranches: 2,
    features: [
      "core_crud",
      "search",
      "mobile_camera",
      "admin_basic",
      "audit_log",
      "gallery_view",
      "multi_photo",
      "reports",
      "analytics",
      // การ์ด "Accounting Module — ผังบัญชี + journal entries + intercompany" (scoped-down first
      // pass, 24 ก.ค. 2026): gate เดียวกับ "reports"/"analytics" (pro+) — การ์ดเองไม่ได้ระบุ tier
      // ตายตัว แต่เป็นฟีเจอร์ระดับ advanced เดียวกัน จึงเลือก threshold เดียวกัน enterprise ได้
      // อยู่แล้วผ่าน "all" convention เดิมของไฟล์นี้ ไม่ต้องเพิ่มซ้ำ
      "accounting_module",
    ],
  },
  enterprise: {
    label: "Enterprise",
    priceMonthly: null, // ติดต่อฝ่ายขาย
    priceYearly: null,
    maxMembers: null,
    maxConcurrentSessions: null,
    stockValueCap: null,
    maxParts: null,
    burstModeMaxAccounts: null, // configurable/เจรจาต่อรายอู่ (ดูหมายเหตุด้านบน)
    maxBranches: null, // ไม่จำกัด
    features: ["all", "multi_branch", "api_access", "custom_reports"],
  },
};

export function getTierConfig(tierKey) {
  return SUBSCRIPTION_TIERS[tierKey] || SUBSCRIPTION_TIERS.starter;
}

export function isUnlimited(value) {
  return value === null || value === undefined;
}
