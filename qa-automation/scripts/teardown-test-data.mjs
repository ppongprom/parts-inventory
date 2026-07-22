#!/usr/bin/env node
// ------------------------------------------------------------
// ลบ test data ที่ setup-test-data.mjs สร้างไว้ทั้งหมด (10 shop: 5 worker + 5 tier)
// รันหลังจบรอบทดสอบทุกครั้ง โดยเฉพาะแถวใน platform_admins ที่ต้องลบก่อนเสมอ
//
// ⚠️ ลำดับสำคัญ: shops.owner_user_id เป็น FK -> auth.users(id) แบบไม่มี
// ON DELETE CASCADE (ดู db/fresh_project_full_schema.sql) ดังนั้นต้องลบ
// แถวใน shops ที่อ้างอิง user นั้นก่อน ไม่งั้น auth.admin.deleteUser จะ fail
// ด้วย foreign key violation — จึงลบ shops (by name) ก่อนเสมอ แล้วค่อยลบ
// shop_members/platform_admins/auth user ทีหลัง
// ------------------------------------------------------------
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STAFF_EMAIL_DOMAIN = "staff.internal.partsinventory.app";
const toStaffEmail = (u) => `${u.toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;

// ---- worker shops 1-5 ----
const WORKER_EMAILS = [];
const WORKER_STAFF_USERNAMES = [];
for (let i = 1; i <= 5; i++) {
  const suffix = i === 1 ? "" : `_S${i}`;
  WORKER_EMAILS.push(process.env[`TEST_OWNER_EMAIL${suffix}`], process.env[`TEST_MANAGER_EMAIL${suffix}`]);
  WORKER_STAFF_USERNAMES.push(
    process.env[`TEST_SUPERVISOR_USERNAME${suffix}`],
    process.env[`TEST_TECHNICIAN_USERNAME${suffix}`],
    process.env[`TEST_ASSISTANT_USERNAME${suffix}`],
    process.env[`TEST_FIELDSCANNER_USERNAME${suffix}`],
    process.env[`TEST_FIELDSCANNER_EXPIRED_USERNAME${suffix}`]
  );
}

// ---- tier shops (trial/starter/founder/pro/enterprise) ----
const TIER_ORDER = ["trial", "starter", "founder", "pro", "enterprise"];
const TIER_EMAILS = [];
const TIER_STAFF_USERNAMES = [];
for (const tier of TIER_ORDER) {
  const prefix = `TEST_TIER_${tier.toUpperCase()}`;
  TIER_EMAILS.push(process.env[`${prefix}_OWNER_EMAIL`]);
  for (let i = 1; i <= 15; i++) {
    const u = process.env[`${prefix}_STAFF${i}_USERNAME`];
    if (u) TIER_STAFF_USERNAMES.push(u);
  }
}

// ---- special one-off accounts (ไม่เปลี่ยนจากเดิม) ----
const SPECIAL_EMAILS = [
  process.env.TEST_OWNER_PLATFORMADMIN_EMAIL,
  process.env.TEST_DISABLED_OWNER_EMAIL,
  process.env.TEST_NEWUSER_EMAIL,
  process.env.TEST_CONCURRENT1_EMAIL,
  process.env.TEST_CONCURRENT2_EMAIL,
  process.env.TEST_CONCURRENT3_EMAIL,
  process.env.TEST_CONCURRENT4_EMAIL,
];

const TEST_EMAILS = [...WORKER_EMAILS, ...TIER_EMAILS, ...SPECIAL_EMAILS].filter(Boolean);
const STAFF_USERNAMES = [...WORKER_STAFF_USERNAMES, ...TIER_STAFF_USERNAMES].filter(Boolean);
const STAFF_EMAILS = STAFF_USERNAMES.map(toStaffEmail);

async function findUserByEmail(email) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 500 });
  if (error) throw error;
  return data.users.find((u) => u.email === email);
}

async function deleteUserEverywhere(email) {
  const user = await findUserByEmail(email);
  if (!user) {
    console.log(`  (ไม่พบ ${email} — ข้าม)`);
    return;
  }

  await supabaseAdmin.from("platform_admins").delete().eq("user_id", user.id);
  await supabaseAdmin.from("shop_members").delete().eq("user_id", user.id);
  await supabaseAdmin.from("user_sessions").delete().eq("user_id", user.id);

  const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (delErr) {
    console.warn(
      `  ⚠️  ลบ auth user ${email} ไม่สำเร็จ: ${delErr.message}\n` +
        `      ถ้าเป็น foreign key violation แปลว่ายังมี shop ที่ owner_user_id ชี้มาที่ user นี้อยู่ ` +
        `— เช็คว่า deleteTestShops() รันไปก่อนหน้านี้จริงหรือเปล่า`
    );
  } else {
    console.log(`  🗑️  ลบ ${email} เรียบร้อย`);
  }
}

const TEST_SHOP_NAMES = [
  // worker shops
  "QA Test Shop (auto)",
  "QA Test Shop (auto) - Worker 2",
  "QA Test Shop (auto) - Worker 3",
  "QA Test Shop (auto) - Worker 4",
  "QA Test Shop (auto) - Worker 5",
  // tier shops
  ...TIER_ORDER.map((t) => `QA Tier Shop - ${t}`),
  // special
  "QA Test Shop B (multi-shop, auto)",
  "QA Platform-Admin Owner Shop (auto)",
  "QA Disabled Shop (auto)",
  "QA Concurrent-Session Shop (auto)",
];

async function wipeShopChildRows(shopId, shopName) {
  const CHILD_TABLES_IN_ORDER = [
    "job_workflow_steps",
    "job_cost_items",
    "job_visibility_groups",
    "job_documents",
    "part_sales",
    "shop_tos_acceptances",
    "parts",
    "salvage_vehicles",
    "jobs",
    "customers",
    "zones",
    "options",
  ];
  for (const table of CHILD_TABLES_IN_ORDER) {
    try {
      const { error } = await supabaseAdmin.from(table).delete().eq("shop_id", shopId);
      if (error) console.warn(`    ⚠️  ล้าง ${table} (shop "${shopName}") ไม่สำเร็จ: ${error.message}`);
    } catch (err) {
      console.warn(`    ⚠️  ข้าม ${table} (shop "${shopName}"): ${err.message}`);
    }
  }
}

async function deleteTestShops() {
  for (const shopName of TEST_SHOP_NAMES) {
    const { data: shopRow } = await supabaseAdmin
      .from("shops")
      .select("shop_id")
      .eq("shop_name", shopName)
      .maybeSingle();

    if (shopRow) {
      await wipeShopChildRows(shopRow.shop_id, shopName);
    }

    const { error } = await supabaseAdmin.from("shops").delete().eq("shop_name", shopName);
    if (!error) console.log(`  🗑️  ลบ shop "${shopName}" เรียบร้อย (ถ้ามีอยู่)`);
    else console.warn(`  ⚠️  ลบ shop "${shopName}" ไม่สำเร็จ: ${error.message}`);
  }
}

async function main() {
  console.log("== Teardown test data: parts-inventory staging (multi-shop) ==\n");
  console.log(`(รวม ${TEST_EMAILS.length} email accounts + ${STAFF_EMAILS.length} staff accounts ที่จะลบ)\n`);

  console.log("[0/2] ลบ visibility_groups ทดสอบ (ถ้ามี)");
  try {
    await supabaseAdmin.from("visibility_groups").delete().eq("name", "QA Test Group A");
    console.log("  🗑️  ลบ 'QA Test Group A' เรียบร้อย (ถ้ามีอยู่)");
  } catch (err) {
    console.warn(`  ⚠️  ข้ามการลบ visibility_groups: ${err.message}`);
  }

  console.log("\n[1/2] ลบ shops ก่อน (กัน FK violation ตอนลบ auth user)");
  await deleteTestShops();

  console.log("\n[2/2] ลบ auth users (พร้อม shop_members/platform_admins ที่เหลือ)");
  for (const email of [...TEST_EMAILS, ...STAFF_EMAILS]) {
    await deleteUserEverywhere(email);
  }

  console.log("\n✅ Teardown เสร็จสมบูรณ์");
}

main().catch((err) => {
  console.error("\n❌ Teardown ล้มเหลว:", err.message);
  process.exit(1);
});
