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
    maxParts: 50,
    trialDays: 14,
    features: ["core_crud", "search", "mobile_camera"],
  },
  starter: {
    label: "Starter",
    priceMonthly: 399,
    priceYearly: 4000,
    maxMembers: 5,
    maxConcurrentSessions: 5,
    maxParts: null, // ไม่จำกัด
    features: ["core_crud", "search", "mobile_camera", "admin_basic"],
  },
  founder: {
    label: "Founder",
    priceMonthly: 649,
    priceYearly: 6500,
    maxMembers: 10,
    maxConcurrentSessions: 8,
    maxParts: null,
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
    maxParts: null,
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
    ],
  },
  enterprise: {
    label: "Enterprise",
    priceMonthly: null, // ติดต่อฝ่ายขาย
    priceYearly: null,
    maxMembers: null,
    maxConcurrentSessions: null,
    maxParts: null,
    features: ["all", "multi_branch", "api_access", "custom_reports"],
  },
};

export function getTierConfig(tierKey) {
  return SUBSCRIPTION_TIERS[tierKey] || SUBSCRIPTION_TIERS.starter;
}

export function isUnlimited(value) {
  return value === null || value === undefined;
}
