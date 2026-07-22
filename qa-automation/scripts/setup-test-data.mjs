#!/usr/bin/env node
// ------------------------------------------------------------
// สร้าง test data ทั้งหมดตาม Test Data Matrix ลง Supabase STAGING
// ใช้ service_role key เท่านั้น — ต้องรันกับ staging project เท่านั้น ห้ามใช้กับ production
//
// ------------------------------------------------------------
// Multi-shop (เพิ่ม 22 ก.ค. 2026) — 10 shop ทั้งหมด แบ่ง 2 ชุด วัตถุประสงค์ต่างกัน:
//
//   1) WORKER SHOPS (5 shop) — clone ของ "QA Test Shop (auto)" เดิม 5 ชุด ทุกชุด plan='enterprise'
//      (ไม่จำกัดที่นั่ง) เหมือนเดิมทุกประการ ใช้รองรับ playwright workers:5 รัน 141 test เดิม
//      ขนานกันได้โดยไม่ชน state — worker N ใช้ env var suffix _S{N} (N=2..5), worker 1 ไม่มี suffix
//      (backward-compat กับตอนรันแบบ manual/single-worker เดิม)
//
//   2) TIER SHOPS (5 shop) — shop ใหม่ทั้งหมด plan ตรงกับชื่อจริง (trial/starter/founder/pro/
//      enterprise) ใช้เฉพาะ P1-P4 risk-based boundary test เท่านั้น (stock-cap, session-limit,
//      seat-limit, feature-gate) — env var ใช้ prefix TEST_TIER_{TIERNAME}_* แยกชุดจาก worker
//      shops โดยสิ้นเชิง กันชนกัน แต่ละ tier shop มี owner 1 คน + staff อเนกประสงค์ 15 คน
//      (พอสำหรับ boundary สูงสุดที่ pro tier ต้องการ = 12+1 = 13 คน)
//
// Schema จริง (ตรวจสอบจาก db/multi_tenant_schema_design.sql, db/auth_multi_tenant_schema.sql):
//   shops:        PK = shop_id, owner_user_id (uuid, NOT NULL), subscription_status, subscription_plan
//   shop_members: PK = member_id, shop_id, user_id, role, status ('active'|'invited'|'disabled')
//   platform_admins: PK = user_id
//
// หมายเหตุสำคัญ: isDisabledAccount ใน lib/AuthProvider.js คำนวณจาก
//   "มีแถวใน shop_members อยู่จริง (allRows.length > 0) แต่ไม่มีแถวไหน status='active' เลย"
// ดังนั้นการจำลอง disabled account ทำได้ตรงๆ ด้วยการตั้ง shop_members.status = 'disabled'
// ไม่ต้องไปยุ่งกับ shops.subscription_status เลย
//
// วิธีรัน:
//   cp .env.example .env   (แล้วกรอกค่าจริง)
//   node scripts/setup-test-data.mjs
// ------------------------------------------------------------
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
// การ์ด "กลไก ToS consent" (คืนวันที่ 21 ก.ค. 2026) — TosConsentGate ครอบทุกหน้าหลัง RequireAuth
// import ตรงจาก config จริงของแอป (ไม่ hardcode เวอร์ชันซ้ำที่นี่) กัน version drift ถ้าทีม dev
// เปลี่ยน CURRENT_TOS_VERSION ทีหลัง — ต้อง seed shop_tos_acceptances ให้ owner ของทุก test shop
// ไว้ล่วงหน้า ไม่งั้น suite เดิมทั้งหมด (login/RBAC/job creation) จะโดน gate บล็อกโดยไม่ตั้งใจ
import { CURRENT_TOS_VERSION } from "../../config/tosContent.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STAFF_EMAIL_DOMAIN = "staff.internal.partsinventory.app"; // ต้องตรงกับ lib/staffAuth.js

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ ต้องตั้งค่า SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env ก่อน");
  process.exit(1);
}
if (SUPABASE_URL.includes("/rest/") || SUPABASE_URL.endsWith("/")) {
  console.error(
    `❌ SUPABASE_URL ห้ามมี path ต่อท้าย (เช่น /rest/v1) หรือ trailing slash — ตอนนี้ค่าคือ: ${SUPABASE_URL}\n` +
      `   ต้องเป็นแค่ https://<project-ref>.supabase.co เท่านั้น (supabase-js จะเติม path เองภายใน)`
  );
  process.exit(1);
}
if (!/staging|dev|test/i.test(SUPABASE_URL)) {
  console.warn(
    "⚠️  SUPABASE_URL ที่ตั้งไว้ไม่มีคำว่า staging/dev/test ใน URL — ตรวจสอบให้แน่ใจว่านี่คือ STAGING project จริงๆ ก่อนไปต่อ"
  );
}

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function usernameToStaffEmail(username) {
  return `${username.toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

async function upsertAuthUser({ email, password }) {
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (!createErr) {
    console.log(`  ✅ สร้าง auth user ใหม่: ${email}`);
    return created.user;
  }

  const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 500,
  });
  if (listErr) throw listErr;

  const existing = list.users.find((u) => u.email === email);
  if (!existing) {
    throw new Error(`สร้าง ${email} ไม่สำเร็จ และหาไม่เจอใน listUsers: ${createErr.message}`);
  }

  await supabaseAdmin.auth.admin.updateUserById(existing.id, { password });
  console.log(`  ♻️  ${email} มีอยู่แล้ว — sync password ให้ตรงกับ .env`);
  return existing;
}

/** shops.owner_user_id เป็น NOT NULL ต้องมี user จริงก่อนถึงจะสร้าง shop ได้ */
async function ensureShop(name, ownerUserId, plan, status = "active") {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("shops")
    .select("shop_id")
    .eq("shop_name", name)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    await supabaseAdmin
      .from("shops")
      .update({ subscription_plan: plan, subscription_status: status })
      .eq("shop_id", existing.shop_id);
    console.log(`  ♻️  shop "${name}" มีอยู่แล้ว (shop_id=${existing.shop_id}) — sync plan=${plan}`);
    return existing.shop_id;
  }

  const { data: created, error } = await supabaseAdmin
    .from("shops")
    .insert({ shop_name: name, owner_user_id: ownerUserId, subscription_plan: plan, subscription_status: status })
    .select("shop_id")
    .single();
  if (error) throw error;
  console.log(`  ✅ สร้าง shop ใหม่: "${name}" (shop_id=${created.shop_id}, plan=${plan})`);
  return created.shop_id;
}

async function upsertShopMember({ userId, shopId, role, status = "active", loginUsername = null, expiresAt = null }) {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("shop_members")
    .select("member_id")
    .eq("user_id", userId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const { error } = await supabaseAdmin
      .from("shop_members")
      .update({ role, status, login_username: loginUsername, expires_at: expiresAt })
      .eq("member_id", existing.member_id);
    if (error) throw error;
  } else {
    const { error } = await supabaseAdmin.from("shop_members").insert({
      user_id: userId,
      shop_id: shopId,
      role,
      status,
      login_username: loginUsername,
      expires_at: expiresAt,
    });
    if (error) throw error;
  }
}

/** การ์ด "กลไก ToS consent" — seed shop_tos_acceptances ให้ owner ของ shop นี้ยอมรับเวอร์ชัน
 *  ปัจจุบันไว้ล่วงหน้าเสมอ (idempotent — เช็คก่อน insert) กัน TosConsentGate บล็อก suite อื่นที่
 *  ไม่ได้ตั้งใจทดสอบ gate เอง */
async function ensureTosAccepted(shopId, ownerUserId) {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from("shop_tos_acceptances")
    .select("id")
    .eq("shop_id", shopId)
    .eq("tos_version", CURRENT_TOS_VERSION)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) return;

  const { error } = await supabaseAdmin
    .from("shop_tos_acceptances")
    .insert({ shop_id: shopId, user_id: ownerUserId, tos_version: CURRENT_TOS_VERSION });
  if (error) throw error;
}

/** ห่อด้วย try/catch เพราะ db/visibility_groups_and_workflow_schema.sql (ไฟล์ที่ README ของ
 *  โปรเจกต์บอกว่าต้องรัน) หายไปจาก repo จริง — เราไม่มีทางยืนยัน 100% จาก repo อย่างเดียวว่า
 *  ตาราง visibility_groups/visibility_group_members มีอยู่จริงใน staging หรือเปล่า */
async function seedVisibilityGroup(shopId, supervisorUsername) {
  try {
    const { data: existingGroup } = await supabaseAdmin
      .from("visibility_groups")
      .select("group_id")
      .eq("shop_id", shopId)
      .eq("name", "QA Test Group A")
      .maybeSingle();

    let groupId = existingGroup?.group_id;
    if (!groupId) {
      const { data: createdGroup, error: groupErr } = await supabaseAdmin
        .from("visibility_groups")
        .insert({ shop_id: shopId, name: "QA Test Group A" })
        .select("group_id")
        .single();
      if (groupErr) throw groupErr;
      groupId = createdGroup.group_id;
    }

    const { data: supervisorUser } = await supabaseAdmin
      .from("shop_members")
      .select("user_id")
      .eq("shop_id", shopId)
      .eq("login_username", supervisorUsername)
      .maybeSingle();

    if (supervisorUser) {
      await supabaseAdmin
        .from("visibility_group_members")
        .upsert({ group_id: groupId, user_id: supervisorUser.user_id }, { onConflict: "group_id,user_id" });
    }
    console.log(`  ✅ visibility_groups group_id=${groupId} ("QA Test Group A")`);
  } catch (err) {
    console.warn(
      `  ⚠️  สร้าง visibility_groups ไม่สำเร็จ (shop_id=${shopId}) — อาจเป็นเพราะตารางนี้ไม่มีอยู่จริงใน staging:\n` +
        `      ${err.message}`
    );
  }
}

function env(name) {
  const v = process.env[name];
  if (!v) console.warn(`  ⚠️  ยังไม่ได้ตั้งค่า ${name} ใน .env`);
  return v;
}

// ------------------------------------------------------------
// 1) WORKER SHOP — full roster เหมือน "QA Test Shop (auto)" เดิมทุกประการ, plan=enterprise
//    shopIndex 1 = ไม่มี suffix (backward compat), 2-5 = suffix _S{n}
// ------------------------------------------------------------
async function setupWorkerShop(shopIndex) {
  const suffix = shopIndex === 1 ? "" : `_S${shopIndex}`;
  const shopName = shopIndex === 1 ? "QA Test Shop (auto)" : `QA Test Shop (auto) - Worker ${shopIndex}`;
  console.log(`\n========== Worker Shop ${shopIndex} (${shopName}) ==========`);

  console.log("[owner]");
  const owner = await upsertAuthUser({
    email: env(`TEST_OWNER_EMAIL${suffix}`),
    password: env(`TEST_OWNER_PASSWORD${suffix}`),
  });
  const shopId = await ensureShop(shopName, owner.id, "enterprise");
  await upsertShopMember({ userId: owner.id, shopId, role: "owner" });
  await ensureTosAccepted(shopId, owner.id);

  console.log("[manager]");
  const manager = await upsertAuthUser({
    email: env(`TEST_MANAGER_EMAIL${suffix}`),
    password: env(`TEST_MANAGER_PASSWORD${suffix}`),
  });
  await upsertShopMember({ userId: manager.id, shopId, role: "manager" });

  let supervisorUsername = null;
  for (const [label, envPrefix, role] of [
    ["supervisor", "SUPERVISOR", "supervisor"],
    ["technician", "TECHNICIAN", "technician"],
    ["assistant", "ASSISTANT", "assistant"],
  ]) {
    console.log(`[${label}]`);
    const username = env(`TEST_${envPrefix}_USERNAME${suffix}`);
    const pin = env(`TEST_${envPrefix}_PIN${suffix}`);
    const user = await upsertAuthUser({ email: usernameToStaffEmail(username), password: pin });
    await upsertShopMember({ userId: user.id, shopId, role, loginUsername: username });
    if (role === "supervisor") supervisorUsername = username;
  }

  console.log("[field_scanner]");
  {
    const username = env(`TEST_FIELDSCANNER_USERNAME${suffix}`);
    const pin = env(`TEST_FIELDSCANNER_PIN${suffix}`);
    const user = await upsertAuthUser({ email: usernameToStaffEmail(username), password: pin });
    await upsertShopMember({ userId: user.id, shopId, role: "field_scanner", loginUsername: username });
  }

  console.log("[field_scanner - expired]");
  {
    const username = env(`TEST_FIELDSCANNER_EXPIRED_USERNAME${suffix}`);
    const pin = env(`TEST_FIELDSCANNER_EXPIRED_PIN${suffix}`);
    const user = await upsertAuthUser({ email: usernameToStaffEmail(username), password: pin });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await upsertShopMember({
      userId: user.id,
      shopId,
      role: "field_scanner",
      loginUsername: username,
      expiresAt: yesterday,
    });
  }

  console.log("[visibility group]");
  await seedVisibilityGroup(shopId, supervisorUsername);

  return shopId;
}

// ------------------------------------------------------------
// 2) TIER SHOP — owner + 15 บัญชี staff อเนกประสงค์ (role=technician ทั้งหมด เพราะจุดประสงค์
//    คือทดสอบ "จำนวน" ไม่ใช่ "สิทธิ์ตาม role") plan = ตาม tier จริง
//    ใช้ env prefix TEST_TIER_{TIERNAME}_* แยกชุดจาก worker shop โดยสิ้นเชิง
// ------------------------------------------------------------
const STAFF_PER_TIER_SHOP = 15; // พอสำหรับ pro tier (maxConcurrentSessions=12, ต้องการ 12+1=13)

async function setupTierShop(tierName) {
  const prefix = `TEST_TIER_${tierName.toUpperCase()}`;
  const shopName = `QA Tier Shop - ${tierName}`;
  console.log(`\n========== Tier Shop: ${tierName} (${shopName}) ==========`);

  console.log("[owner]");
  const owner = await upsertAuthUser({
    email: env(`${prefix}_OWNER_EMAIL`),
    password: env(`${prefix}_OWNER_PASSWORD`),
  });
  const shopId = await ensureShop(shopName, owner.id, tierName);
  await upsertShopMember({ userId: owner.id, shopId, role: "owner" });
  await ensureTosAccepted(shopId, owner.id);

  console.log(`[staff x${STAFF_PER_TIER_SHOP}]`);
  for (let i = 1; i <= STAFF_PER_TIER_SHOP; i++) {
    const username = env(`${prefix}_STAFF${i}_USERNAME`);
    const pin = env(`${prefix}_STAFF${i}_PIN`);
    if (!username || !pin) continue; // เผื่อ .env ยังกรอกไม่ครบ 15 คน ไม่ให้ script ล้มทั้งหมด
    const user = await upsertAuthUser({ email: usernameToStaffEmail(username), password: pin });
    // ตั้งใจไม่ upsertShopMember ที่นี่ — ปล่อยให้ user auth มีตัวตนไว้เฉยๆ ก่อน
    // (ไม่ insert เป็นสมาชิกจริง) เพื่อให้ test P2/P3 เป็นคน "invite เข้าจริง" ผ่าน API แอปเอง
    // ตอนทดสอบ boundary — ถ้า seed เป็นสมาชิกไว้ล่วงหน้าหมดจะทดสอบ "invite ครั้งที่ N+1 โดนบล็อก"
    // ไม่ได้เลย เพราะสมาชิกเต็มอยู่ก่อนแล้วตั้งแต่ setup
  }
  console.log(`  ✅ เตรียม auth user ${STAFF_PER_TIER_SHOP} คนไว้แล้ว (ยังไม่ join shop — ให้ test เป็นคน invite เองตอนทดสอบ boundary)`);

  return shopId;
}

async function main() {
  console.log("== Setup test data: parts-inventory staging (multi-shop) ==");

  // ---- 5 worker shops ----
  const workerShopIds = [];
  for (let i = 1; i <= 5; i++) {
    workerShopIds.push(await setupWorkerShop(i));
  }

  // ---- 5 tier shops ----
  const TIER_ORDER = ["trial", "starter", "founder", "pro", "enterprise"];
  const tierShopIds = {};
  for (const tier of TIER_ORDER) {
    tierShopIds[tier] = await setupTierShop(tier);
  }

  const shopId = workerShopIds[0]; // shop A หลัก (worker 1) ใช้ต่อสำหรับ special shops ด้านล่าง เหมือนเดิม

  // ---- owner + platform_admin (แยกอู่ของตัวเองไปเลย กันชนกับ owner หลัก) ----
  console.log("\n========== [owner + platform_admin] ==========");
  const ownerPA = await upsertAuthUser({
    email: env("TEST_OWNER_PLATFORMADMIN_EMAIL"),
    password: env("TEST_OWNER_PLATFORMADMIN_PASSWORD"),
  });
  const shopIdPaOnly = await ensureShop("QA Platform-Admin Owner Shop (auto)", ownerPA.id, "enterprise");
  await upsertShopMember({ userId: ownerPA.id, shopId: shopIdPaOnly, role: "owner" });
  const { error: paErr } = await supabaseAdmin
    .from("platform_admins")
    .upsert({ user_id: ownerPA.id }, { onConflict: "user_id" });
  if (paErr) throw paErr;
  console.log("  ✅ เพิ่มแถวใน platform_admins แล้ว");
  await ensureTosAccepted(shopIdPaOnly, ownerPA.id);

  // ---- multi-shop owner (TC-007): owner ของ shop A (worker 1), manager ของ shop B ----
  console.log("\n========== [owner - multi shop] ==========");
  const ownerRow = await upsertAuthUser({ email: env("TEST_OWNER_EMAIL"), password: env("TEST_OWNER_PASSWORD") });
  const shopIdB = await ensureShop("QA Test Shop B (multi-shop, auto)", ownerRow.id, "enterprise");
  await upsertShopMember({ userId: ownerRow.id, shopId: shopIdB, role: "manager" });
  await ensureTosAccepted(shopIdB, ownerRow.id);
  console.log(`  ✅ owner หลัก (worker 1) เป็น owner ที่ shop A และ manager ที่ shop B (${shopIdB})`);

  // ---- disabled owner (TC-106) ----
  console.log("\n========== [disabled owner] ==========");
  const disabledOwner = await upsertAuthUser({
    email: env("TEST_DISABLED_OWNER_EMAIL"),
    password: env("TEST_DISABLED_OWNER_PASSWORD"),
  });
  const disabledShopId = await ensureShop("QA Disabled Shop (auto)", disabledOwner.id, "enterprise");
  await upsertShopMember({ userId: disabledOwner.id, shopId: disabledShopId, role: "owner", status: "disabled" });
  console.log("  ✅ ตั้ง shop_members.status='disabled' แล้ว");

  // ---- new user, no membership at all (TC-107) ----
  console.log("\n========== [new user - no membership] ==========");
  await upsertAuthUser({ email: env("TEST_NEWUSER_EMAIL"), password: env("TEST_NEWUSER_PASSWORD") });
  console.log("  ✅ สร้าง auth user แล้ว ไม่ insert shop_members ใดๆ (ตั้งใจเว้นว่างไว้)");

  // ---- concurrent-session test shop เดิม (TC-302) — คงไว้แบบเดิมไม่แตะ ----
  console.log("\n========== [concurrent-session test shop (TC-302 เดิม)] ==========");
  const concurrentUsers = [];
  for (let i = 0; i < 4; i++) {
    const envN = i + 1;
    concurrentUsers.push(
      await upsertAuthUser({
        email: env(`TEST_CONCURRENT${envN}_EMAIL`),
        password: env(`TEST_CONCURRENT${envN}_PASSWORD`),
      })
    );
  }
  const { data: existingConcShop } = await supabaseAdmin
    .from("shops")
    .select("shop_id")
    .eq("shop_name", "QA Concurrent-Session Shop (auto)")
    .maybeSingle();
  let concurrentShopId;
  if (existingConcShop) {
    concurrentShopId = existingConcShop.shop_id;
  } else {
    const { data: createdConcShop, error: concShopErr } = await supabaseAdmin
      .from("shops")
      .insert({
        shop_name: "QA Concurrent-Session Shop (auto)",
        owner_user_id: concurrentUsers[0].id,
        subscription_plan: "trial",
        subscription_status: "trialing",
      })
      .select("shop_id")
      .single();
    if (concShopErr) throw concShopErr;
    concurrentShopId = createdConcShop.shop_id;
  }
  const concurrentRoles = ["owner", "manager", "supervisor", "technician"];
  for (let i = 0; i < concurrentUsers.length; i++) {
    await upsertShopMember({ userId: concurrentUsers[i].id, shopId: concurrentShopId, role: concurrentRoles[i] });
  }
  await ensureTosAccepted(concurrentShopId, concurrentUsers[0].id);
  console.log(`  ✅ shop_id=${concurrentShopId} (plan=trial, maxConcurrentSessions=3) — 4 คนเป็นสมาชิกแล้ว`);

  console.log("\n\n✅✅✅ Setup test data (multi-shop) เสร็จสมบูรณ์ ✅✅✅");
  console.log("\nสรุป Worker Shops:");
  workerShopIds.forEach((id, i) => console.log(`  Worker ${i + 1}: shop_id=${id}`));
  console.log("\nสรุป Tier Shops:");
  for (const tier of TIER_ORDER) console.log(`  ${tier}: shop_id=${tierShopIds[tier]}`);
  console.log(`\nSpecial shops:\n  Platform-admin owner: ${shopIdPaOnly}\n  Multi-shop B: ${shopIdB}\n  Disabled: ${disabledShopId}\n  Concurrent-session: ${concurrentShopId}`);
}

main().catch((err) => {
  console.error("\n❌ Setup ล้มเหลว:", err.message);
  process.exit(1);
});
