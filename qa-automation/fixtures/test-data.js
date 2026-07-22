// โหลด credential ของ test account ทั้งหมดจาก .env
// ตรงกับ Test Data Matrix ในไฟล์ test_cases_login_rbac_parts_inventory.xlsx
//
// ------------------------------------------------------------
// Multi-shop support (เพิ่มเข้ามา 22 ก.ค. 2026)
// ------------------------------------------------------------
// Playwright ตั้ง process.env.TEST_PARALLEL_INDEX ให้อัตโนมัติต่อ worker
// (0-indexed, ตั้งแต่ Playwright 1.10+ — ยืนยันแล้วว่าเวอร์ชัน 1.47.0 ที่ใช้อยู่รองรับ)
// เรา map worker index -> shop slot 1-5 แบบวนซ้ำ (ถ้า workers > 5 จะวนกลับมาใช้ shop 1 ใหม่
// ซึ่งไม่ควรเกิดขึ้นจริงเพราะตั้งใจให้ workers=5 เท่ากับจำนวน shop พอดี)
//
// Shop 1 ยังคงใช้ชื่อ env var เดิมแบบไม่มี suffix (TEST_OWNER_EMAIL ฯลฯ) เพื่อ backward-compat
// กับตอนรันแบบ manual/single-worker แบบเดิม — shop 2-5 ใช้ suffix _S2.._S5
//
// accounts.xxx ยังคงหน้าตาเดิมทุกประการ (test file เดิมทั้ง 141 ไฟล์ไม่ต้องแก้อะไรเลย)
// เพราะ resolve ค่าใหม่ตอน import ครั้งแรกของแต่ละ worker process เท่านั้น
import "dotenv/config";

const SHOP_COUNT = 5;

// worker 0 -> shop 1, worker 1 -> shop 2, ... worker 4 -> shop 5, worker 5 -> shop 1 (วนซ้ำ)
const parallelIndex = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
export const currentShopIndex = (parallelIndex % SHOP_COUNT) + 1;

// shop 1 = trial, 2 = starter, 3 = founder, 4 = pro, 5 = enterprise
// ต้องตรงกับลำดับที่ scripts/setup-test-data.mjs provision จริง — แก้ที่นี่ต้องไปแก้ที่นั่นด้วย
export const SHOP_TIER_ORDER = ["trial", "starter", "founder", "pro", "enterprise"];
export const currentShopTier = SHOP_TIER_ORDER[currentShopIndex - 1];

function envName(baseName) {
  // shop 1 ใช้ชื่อเดิมไม่มี suffix เสมอ (backward compat กับ manual/single-shop run)
  return currentShopIndex === 1 ? baseName : `${baseName}_S${currentShopIndex}`;
}

function required(baseName) {
  const name = envName(baseName);
  const v = process.env[name];
  if (!v) {
    console.warn(
      `[test-data] ⚠️  ยังไม่ได้ตั้งค่า ${name} ใน .env (shop ${currentShopIndex}/${currentShopTier}) — test ที่ใช้ค่านี้จะ fail`
    );
  }
  return v;
}

// ไม่ผูกกับ shop เพราะเป็นค่าระดับ Supabase project เดียวกันทั้งหมด (ทุก shop อยู่ project เดียวกัน)
function requiredGlobal(name) {
  const v = process.env[name];
  if (!v) {
    console.warn(`[test-data] ⚠️  ยังไม่ได้ตั้งค่า ${name} ใน .env — test ที่ใช้ค่านี้จะ fail`);
  }
  return v;
}

export const supabaseUrl = requiredGlobal("SUPABASE_URL");
export const supabasePublishableKey = requiredGlobal("SUPABASE_PUBLISHABLE_KEY");

export const accounts = {
  owner: {
    email: required("TEST_OWNER_EMAIL"),
    password: required("TEST_OWNER_PASSWORD"),
    role: "owner",
  },
  manager: {
    email: required("TEST_MANAGER_EMAIL"),
    password: required("TEST_MANAGER_PASSWORD"),
    role: "manager",
  },
  supervisor: {
    username: required("TEST_SUPERVISOR_USERNAME"),
    pin: required("TEST_SUPERVISOR_PIN"),
    role: "supervisor",
  },
  technician: {
    username: required("TEST_TECHNICIAN_USERNAME"),
    pin: required("TEST_TECHNICIAN_PIN"),
    role: "technician",
  },
  assistant: {
    username: required("TEST_ASSISTANT_USERNAME"),
    pin: required("TEST_ASSISTANT_PIN"),
    role: "assistant",
  },
  // หมายเหตุ: platformAdmin/disabledOwner/newUser เป็น account ระดับ platform หรือ
  // ใช้ครั้งเดียวทิ้ง (signup ใหม่) — ไม่ต้องมีชุดแยกต่อ shop ยังใช้ global เหมือนเดิม
  ownerPlatformAdmin: {
    email: requiredGlobal("TEST_OWNER_PLATFORMADMIN_EMAIL"),
    password: requiredGlobal("TEST_OWNER_PLATFORMADMIN_PASSWORD"),
    role: "owner",
  },
  disabledOwner: {
    email: requiredGlobal("TEST_DISABLED_OWNER_EMAIL"),
    password: requiredGlobal("TEST_DISABLED_OWNER_PASSWORD"),
    role: "owner",
  },
  newUser: {
    email: requiredGlobal("TEST_NEWUSER_EMAIL"),
    password: requiredGlobal("TEST_NEWUSER_PASSWORD"),
    role: null,
  },
  // การ์ด "Field Scanner Role" (คืนวันที่ 21 ก.ค. 2026) — username+PIN เหมือน staff ทั่วไป
  fieldScanner: {
    username: required("TEST_FIELDSCANNER_USERNAME"),
    pin: required("TEST_FIELDSCANNER_PIN"),
    role: "field_scanner",
  },
  // shop_members.expires_at ถูก setup-test-data.mjs ตั้งเป็น "เมื่อวาน" เสมอ (คำนวณสดตอน setup)
  // ใช้ยืนยันว่า login ไม่ผ่านพร้อมข้อความ "บัญชีชั่วคราวนี้หมดอายุแล้ว" (ดู expected ใน
  // fixtures/auth-helpers.js -> expectExpiredAccountScreen)
  fieldScannerExpired: {
    username: required("TEST_FIELDSCANNER_EXPIRED_USERNAME"),
    pin: required("TEST_FIELDSCANNER_EXPIRED_PIN"),
    role: "field_scanner",
  },
};

// TC-302: 4 บัญชีแยกในอู่เฉพาะที่ตั้ง plan='trial' (maxConcurrentSessions=3)
// เพื่อทดสอบว่าคนที่ 4 ที่ login พร้อมกันโดนบล็อกจริงไหม
// *** ไม่ผูกกับ shop-per-worker mapping ด้านบน — นี่คือ shop เฉพาะทางแยกต่างหากเสมอ
// (ตอนนี้ตรงกับ shop 1 = trial พอดีเพราะ SHOP_TIER_ORDER เริ่มด้วย trial แต่ให้ตั้งใจอ้างอิงตรง ๆ
// ผ่าน TEST_CONCURRENT* เดิม ไม่พึ่ง currentShopIndex เพื่อกันสับสนกับ tier-boundary test ชุดใหม่)
export const concurrentAccounts = [1, 2, 3, 4].map((n) => ({
  email: requiredGlobal(`TEST_CONCURRENT${n}_EMAIL`),
  password: requiredGlobal(`TEST_CONCURRENT${n}_PASSWORD`),
}));

// ------------------------------------------------------------
// Tier-boundary testing (ใหม่ 22 ก.ค. 2026) — P1-P4 risk-based test
// ------------------------------------------------------------
// คนละชุดกับ WORKER SHOPS ด้านบนโดยสิ้นเชิง (env prefix ต่างกัน กันชนกัน):
//   worker shop  -> TEST_OWNER_EMAIL_S{2..5}  (ใช้กับ accounts.owner ด้านบน ผูกกับ worker ปัจจุบัน)
//   tier shop    -> TEST_TIER_{TIERNAME}_*    (ใช้ฟังก์ชันด้านล่างนี้ ไม่ผูกกับ worker เลย
//                    เพราะ boundary test ต้องเลือก tier ที่ต้องการตรงๆ ไม่สนใจว่า worker ไหนรันอยู่)
//
// tier shop มี owner 1 คน + staff อเนกประสงค์ 15 คน (ยังไม่ join shop ตอน setup — รอให้ตัว test
// เป็นคน invite เข้าจริงตอนทดสอบ boundary เอง ดู scripts/setup-test-data.mjs -> setupTierShop)
const STAFF_PER_TIER_SHOP = 15;

export function getTierShopOwner(tierName) {
  if (!SHOP_TIER_ORDER.includes(tierName)) {
    throw new Error(`ไม่รู้จัก tier "${tierName}" — ต้องเป็นหนึ่งใน ${SHOP_TIER_ORDER.join(", ")}`);
  }
  const prefix = `TEST_TIER_${tierName.toUpperCase()}`;
  return {
    tier: tierName,
    email: requiredGlobal(`${prefix}_OWNER_EMAIL`),
    password: requiredGlobal(`${prefix}_OWNER_PASSWORD`),
    role: "owner",
  };
}

/** คืน array ของ staff account ที่ "ยังไม่ join shop" (username+pin เฉยๆ) ไว้ให้ test
 *  เรียก invite ผ่าน API จริงเองตอนทดสอบ boundary — count = จำนวนที่ต้องการ (สูงสุด 15) */
export function getTierShopStaffPool(tierName, count = STAFF_PER_TIER_SHOP) {
  if (!SHOP_TIER_ORDER.includes(tierName)) {
    throw new Error(`ไม่รู้จัก tier "${tierName}" — ต้องเป็นหนึ่งใน ${SHOP_TIER_ORDER.join(", ")}`);
  }
  if (count > STAFF_PER_TIER_SHOP) {
    throw new Error(`ขอ ${count} คนเกินที่ seed ไว้ (${STAFF_PER_TIER_SHOP} คน) — เพิ่ม STAFF_PER_TIER_SHOP ทั้ง 2 ไฟล์ (test-data.js + setup-test-data.mjs) ก่อน`);
  }
  const prefix = `TEST_TIER_${tierName.toUpperCase()}`;
  const pool = [];
  for (let i = 1; i <= count; i++) {
    pool.push({
      username: requiredGlobal(`${prefix}_STAFF${i}_USERNAME`),
      pin: requiredGlobal(`${prefix}_STAFF${i}_PIN`),
    });
  }
  return pool;
}

// หน้าที่ตาม RequireAuth allowedRoles จริงในโค้ด (branch: staging)
export const pageAccess = {
  adminOnly: ["/admin/options", "/admin/zones", "/admin/reports", "/admin/trash"],
  allShopRoles: ["/jobs", "/jobs/new", "/add", "/admin/groups"],
  // คืนวันที่ 21 ก.ค. 2026 — หน้าใหม่ที่จำกัด role เพิ่มเติมจาก allShopRoles เดิม
  ownerManagerOnly: ["/admin/import-customers"], // import CSV ลูกค้า — owner/manager เท่านั้น
  // เฉพาะ /add, /edit/[id] เท่านั้นที่ field_scanner เข้าได้ (ตรวจจาก allowedRoles จริงในโค้ด) —
  // /salvage-vehicles, /move-part/[id], /move-parts **ไม่รวม** field_scanner (ตรวจแล้วในโค้ดจริง)
  allShopRolesPlusFieldScanner: ["/add", "/edit"],
};

export const allowedRoles = {
  adminOnly: ["owner", "manager"],
  allShopRoles: ["owner", "manager", "supervisor", "technician", "assistant"],
  ownerManagerOnly: ["owner", "manager"],
  allShopRolesPlusFieldScanner: ["owner", "manager", "supervisor", "technician", "assistant", "field_scanner"],
  // salvage-vehicles/new จำกัดกว่าเพื่อน (ไม่รวม assistant) — ดู app/salvage-vehicles/new/page.js
  salvageIntake: ["owner", "manager", "supervisor", "technician"],
};
