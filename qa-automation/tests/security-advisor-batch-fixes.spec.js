// Card: "🔴 P0: Supabase Security Advisor batch (24 ก.ค. 2569) — RLS bypass บน parts +
// accounting RPC ไม่เช็คสิทธิ์ + hygiene อื่นๆ" (Notion 3a7f39f45649817c85a3c1e2feca40dc)
//
// Proves the two confirmed-exploitable P0 vulnerabilities are closed, with zero regression on
// legitimate same-shop usage:
//   P0-1: parts."estimated_value floor on insert/update" was PERMISSIVE (OR'd with the normal
//         "eligible roles can insert/update parts" policy) instead of RESTRICTIVE (AND'd) — live
//         PoC during investigation confirmed a `technician` could set/overwrite
//         parts.estimated_value on their OWN shop despite not being an elevated role (the floor
//         didn't hold at all). Fixed by converting both policies to RESTRICTIVE.
//   P0-2: fn_insert_system_journal_entry / fn_get_or_open_period / fn_backfill_current_period_sales /
//         fn_recalc_stock_cap_status / fn_seed_default_chart_of_accounts had zero is_shop_member()
//         check — live PoC confirmed a shop-4 technician could inject a fabricated journal entry
//         and open a new accounting period for a totally unrelated shop. Fixed by adding an
//         is_shop_member() guard matching each function's real caller convention (see
//         db/security_advisor_batch_fixes_migration.sql for the per-function role-set reasoning).
//
// Pattern: mirrors qa-automation/tests/db-rls.spec.js (RLS proven at the DB/publishable-key
// level, no browser/UI involved) for P0-1, and qa-automation/tests/accounting-module-core.spec.js
// (own pro-tier shop via createShop()) for P0-2.
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInEmail, signInStaff, adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { accounts, currentShopName, supabaseUrl, supabasePublishableKey } from "../fixtures/test-data.js";

const RUN_ID = Date.now();

async function getOwnerClient(email, password) {
  const client = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ล้มเหลว (${email}): ${error.message}`);
  return { client, userId: data.user.id };
}

// mirror ของ createShop() ใน accounting-module-core.spec.js / stock-summary-report.spec.js
async function createShop({ name, plan = "pro", ownerUserId }) {
  const { data, error } = await adminClient()
    .from("shops")
    .insert({ shop_name: name, subscription_plan: plan, owner_user_id: ownerUserId })
    .select("shop_id")
    .single();
  if (error) throw new Error(`สร้างร้าน ${name} ไม่สำเร็จ: ${error.message}`);

  const { data: branch, error: branchError } = await adminClient()
    .from("branches")
    .insert({ shop_id: data.shop_id, branch_code: "00000", branch_name: "สาขาหลัก (QA)", is_default: true })
    .select("branch_id")
    .single();
  if (branchError) throw new Error(`สร้างสาขาหลักไม่สำเร็จ: ${branchError.message}`);

  const { error: memberError } = await adminClient()
    .from("shop_members")
    .insert({ shop_id: data.shop_id, user_id: ownerUserId, role: "owner", status: "active", branch_id: branch.branch_id });
  if (memberError) throw new Error(`เพิ่ม owner membership ไม่สำเร็จ: ${memberError.message}`);
  return data.shop_id;
}

test.describe("SEC — P0-1: parts.estimated_value floor is RESTRICTIVE (cross-shop write bypass closed)", () => {
  let mainShopId;
  let foreignShopId; // "อู่คนอื่น" ที่ technician ของ mainShop ไม่ได้เป็นสมาชิกเลย
  const partIds = [];
  let foreignPartId; // แถวมีอยู่แล้วใน foreignShopId ไว้ทดสอบ cross-shop UPDATE โดยเฉพาะ

  test.beforeAll(async () => {
    mainShopId = await getShopIdByName(currentShopName);
    foreignShopId = await getShopIdByName("QA Platform-Admin Owner Shop (auto)");

    const { data, error } = await adminClient()
      .from("parts")
      .insert({
        shop_id: foreignShopId,
        part_name: `QA-SEC-FOREIGN-${RUN_ID}`,
        price: 100,
        quantity: 1,
        estimated_value: null,
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    foreignPartId = data.id;
  });

  test.afterAll(async () => {
    for (const id of partIds) await adminClient().from("parts").delete().eq("id", id);
    if (foreignPartId) await adminClient().from("parts").delete().eq("id", foreignPartId);
  });

  test("SEC-001 technician เพิ่มอะไหล่ในอู่ตัวเอง estimated_value=null ต้องสำเร็จ (positive control, ไม่มี regression)", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const { data, error } = await client
      .from("parts")
      .insert({ shop_id: mainShopId, part_name: `QA-SEC-OWN-${RUN_ID}`, price: 10, quantity: 1, estimated_value: null })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data?.id).toBeTruthy();
    partIds.push(data.id);
  });

  test("SEC-002 technician ตั้ง estimated_value ตอน INSERT ในอู่ตัวเอง ต้องถูกปฏิเสธ (floor บังคับใช้จริง)", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const { data, error } = await client
      .from("parts")
      .insert({ shop_id: mainShopId, part_name: `QA-SEC-FLOOR-INS-${RUN_ID}`, price: 10, quantity: 1, estimated_value: 777777 })
      .select("id");
    expect(error, "ต้องถูก RLS ปฏิเสธ (estimated_value floor on insert, restrictive)").not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  test("SEC-003 technician ตั้ง estimated_value ตอน UPDATE ของอะไหล่ตัวเองในอู่ตัวเอง ต้องถูกปฏิเสธ (bug เดิม: เคยเซ็ตผ่านได้)", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const targetId = partIds[0];
    const { error } = await client.from("parts").update({ estimated_value: 555555 }).eq("id", targetId);
    expect(error, "ต้องถูก RLS ปฏิเสธ (estimated_value floor on update, restrictive)").not.toBeNull();

    const { data: check } = await adminClient().from("parts").select("estimated_value").eq("id", targetId).single();
    expect(check.estimated_value).toBeNull();
  });

  test("SEC-004 owner ตั้ง estimated_value ในอู่ตัวเอง ต้องสำเร็จ (positive control — role สูงพอ)", async () => {
    const { client } = await signInEmail(accounts.owner.email, accounts.owner.password);
    const targetId = partIds[0];
    const { error } = await client.from("parts").update({ estimated_value: 999 }).eq("id", targetId);
    expect(error, error?.message).toBeNull();

    const { data: check } = await adminClient().from("parts").select("estimated_value").eq("id", targetId).single();
    expect(Number(check.estimated_value)).toBe(999);
  });

  test("SEC-005 [สำคัญที่สุด] technician อู่หลัก พยายาม INSERT parts ของอู่อื่น (estimated_value=null) ต้องถูกปฏิเสธ", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const { data, error } = await client
      .from("parts")
      .insert({ shop_id: foreignShopId, part_name: `QA-SEC-CROSSSHOP-INS-${RUN_ID}`, price: 999, quantity: 1, estimated_value: null })
      .select("id");
    expect(error, "cross-shop INSERT ต้องถูกปฏิเสธ ไม่ใช่แค่ silent-empty").not.toBeNull();
    expect(data ?? []).toEqual([]);

    const { data: leaked } = await adminClient()
      .from("parts")
      .select("id")
      .eq("shop_id", foreignShopId)
      .like("part_name", "QA-SEC-CROSSSHOP-INS-%");
    expect(leaked).toEqual([]);
  });

  test("SEC-006 [สำคัญที่สุด] technician อู่หลัก พยายาม UPDATE แถวที่มีอยู่แล้วของอู่อื่น ต้องถูกปฏิเสธ/ไม่มีผล", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const { data, error } = await client
      .from("parts")
      .update({ price: 999999, part_name: "PWNED" })
      .eq("id", foreignPartId)
      .select();
    // RLS filter ที่ระดับ USING ทำให้ query สำเร็จแต่ไม่มีแถวถูกแก้ (ไม่ error) — เช็คทั้ง data ว่าง
    // และยืนยันจริงว่าแถวต้นทางไม่ถูกแตะเลย
    expect(data ?? []).toEqual([]);

    const { data: check } = await adminClient().from("parts").select("price, part_name").eq("id", foreignPartId).single();
    expect(Number(check.price)).toBe(100);
    expect(check.part_name).not.toBe("PWNED");
  });
});

test.describe("SEC — P0-2: accounting RPCs require shop membership (cross-shop journal injection closed)", () => {
  test.describe.configure({ mode: "serial" });

  let ownerAUserId;
  let ownerAClient;
  let ownerBUserId;
  let ownerBClient;
  let shopAId;
  let shopBId;
  const cleanupShopIds = [];

  test.beforeAll(async () => {
    const a = await getOwnerClient(accounts.owner.email, accounts.owner.password);
    ownerAClient = a.client;
    ownerAUserId = a.userId;
    shopAId = await createShop({ name: `QA SEC Accounting A ${RUN_ID}`, ownerUserId: ownerAUserId });
    cleanupShopIds.push(shopAId);

    const b = await getOwnerClient(accounts.ownerPlatformAdmin.email, accounts.ownerPlatformAdmin.password);
    ownerBClient = b.client;
    ownerBUserId = b.userId;
    // shopBId = อู่ที่มีอยู่แล้วของ ownerPlatformAdmin (ไม่ต้องสร้างใหม่ ใช้ตัวตนจริงที่แยกจาก shopA ชัดเจน)
    shopBId = await getShopIdByName("QA Platform-Admin Owner Shop (auto)");
  });

  test.afterAll(async () => {
    for (const id of cleanupShopIds) {
      await adminClient().from("journal_entries").delete().eq("shop_id", id);
      await adminClient().from("accounting_periods").delete().eq("shop_id", id);
      await adminClient().from("accounting_accounts").delete().eq("shop_id", id);
      await adminClient().from("shop_members").delete().eq("shop_id", id);
      await adminClient().from("branches").delete().eq("shop_id", id);
      await adminClient().from("shops").delete().eq("shop_id", id);
    }
    // เก็บกวาด journal entry/period ที่แตะ shopBId (อู่ที่ยืมมา ไม่ใช่ของ suite นี้ ห้ามลบทั้งอู่)
    await adminClient()
      .from("journal_entries")
      .delete()
      .eq("shop_id", shopBId)
      .like("description", "QA-SEC-%");
  });

  test("SEC-101 owner เรียก fn_insert_system_journal_entry ให้อู่ตัวเอง ต้องสำเร็จ (positive control)", async () => {
    const { data, error } = await ownerAClient.rpc("fn_insert_system_journal_entry", {
      p_shop_id: shopAId,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `QA-SEC-101-${RUN_ID}`,
      p_source_type: "manual",
      p_source_table: null,
      p_source_id: null,
      p_lines: [
        { account_code: "1010100", debit: 1, credit: 0 },
        { account_code: "4060100", debit: 0, credit: 1 },
      ],
    });
    expect(error, error?.message).toBeNull();
    expect(data?.entry_id).toBeTruthy();
  });

  test("SEC-102 technician (role ที่ part_sales อนุญาตให้บันทึกการขาย) เรียกให้อู่ตัวเอง ต้องสำเร็จ (ไม่พัง flow ขายของจริง)", async () => {
    const { client } = await signInStaff(accounts.technician.username, accounts.technician.pin);
    const mainShopId = await getShopIdByName(currentShopName);
    const { data, error } = await client.rpc("fn_insert_system_journal_entry", {
      p_shop_id: mainShopId,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `QA-SEC-102-${RUN_ID}`,
      p_source_type: "manual",
      p_source_table: null,
      p_source_id: null,
      p_lines: [
        { account_code: "1010100", debit: 1, credit: 0 },
        { account_code: "4060100", debit: 0, credit: 1 },
      ],
    });
    expect(error, error?.message).toBeNull();
    expect(data?.entry_id).toBeTruthy();
    await adminClient().from("journal_entries").delete().eq("entry_id", data.entry_id);
  });

  test("SEC-103 [สำคัญที่สุด] owner อู่ A เรียก fn_insert_system_journal_entry ใส่ p_shop_id ของอู่ B ต้องถูกปฏิเสธ", async () => {
    const { error } = await ownerAClient.rpc("fn_insert_system_journal_entry", {
      p_shop_id: shopBId,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `QA-SEC-103-FORGED-${RUN_ID}`,
      p_source_type: "manual",
      p_source_table: null,
      p_source_id: null,
      p_lines: [
        { account_code: "1010100", debit: 9999999, credit: 0 },
        { account_code: "4060100", debit: 0, credit: 9999999 },
      ],
    });
    expect(error, "cross-shop journal injection ต้องถูกปฏิเสธ").not.toBeNull();
    expect(error.message).toMatch(/ไม่มีสิทธิ์/);

    const { data: leaked } = await adminClient()
      .from("journal_entries")
      .select("entry_id")
      .eq("shop_id", shopBId)
      .like("description", "QA-SEC-103%");
    expect(leaked).toEqual([]);
  });

  test("SEC-104 [สำคัญที่สุด] owner อู่ A เรียก fn_get_or_open_period ใส่ p_shop_id ของอู่ B ต้องถูกปฏิเสธ", async () => {
    const { error } = await ownerAClient.rpc("fn_get_or_open_period", {
      p_shop_id: shopBId,
      p_date: new Date().toISOString().slice(0, 10),
    });
    expect(error, "cross-shop period open ต้องถูกปฏิเสธ").not.toBeNull();
    expect(error.message).toMatch(/ไม่มีสิทธิ์/);
  });

  test("SEC-105 owner อู่ B เรียก fn_get_or_open_period ให้อู่ตัวเอง ต้องสำเร็จ (positive control)", async () => {
    const { data, error } = await ownerBClient.rpc("fn_get_or_open_period", {
      p_shop_id: shopBId,
      p_date: new Date().toISOString().slice(0, 10),
    });
    expect(error, error?.message).toBeNull();
    expect(data?.shop_id).toBe(shopBId);
  });

  test("SEC-106 [สำคัญที่สุด] owner อู่ A เรียก fn_backfill_current_period_sales/fn_recalc_stock_cap_status/fn_seed_default_chart_of_accounts ใส่ p_shop_id ของอู่ B ต้องถูกปฏิเสธทั้งหมด", async () => {
    const { error: e1 } = await ownerAClient.rpc("fn_backfill_current_period_sales", { p_shop_id: shopBId });
    expect(e1, "fn_backfill_current_period_sales cross-shop ต้องถูกปฏิเสธ").not.toBeNull();
    expect(e1.message).toMatch(/ไม่มีสิทธิ์/);

    const { error: e2 } = await ownerAClient.rpc("fn_recalc_stock_cap_status", { p_shop_id: shopBId });
    expect(e2, "fn_recalc_stock_cap_status cross-shop ต้องถูกปฏิเสธ").not.toBeNull();
    expect(e2.message).toMatch(/ไม่มีสิทธิ์/);

    const { error: e3 } = await ownerAClient.rpc("fn_seed_default_chart_of_accounts", { p_shop_id: shopBId });
    expect(e3, "fn_seed_default_chart_of_accounts cross-shop ต้องถูกปฏิเสธ").not.toBeNull();
    expect(e3.message).toMatch(/ไม่มีสิทธิ์/);
  });

  test("SEC-107 owner อู่ A เรียกทั้ง 3 ฟังก์ชันให้อู่ตัวเอง ต้องสำเร็จ (positive control, ไม่มี regression)", async () => {
    const { error: e1 } = await ownerAClient.rpc("fn_seed_default_chart_of_accounts", { p_shop_id: shopAId });
    expect(e1, e1?.message).toBeNull();

    const { error: e2 } = await ownerAClient.rpc("fn_backfill_current_period_sales", { p_shop_id: shopAId });
    expect(e2, e2?.message).toBeNull();

    const { error: e3 } = await ownerAClient.rpc("fn_recalc_stock_cap_status", { p_shop_id: shopAId });
    expect(e3, e3?.message).toBeNull();
  });

  test("SEC-108 [สำคัญที่สุด] ผู้ใช้ที่ไม่ login เลย (แค่ anon key เปล่าๆ) เรียก fn_insert_system_journal_entry/fn_get_or_open_period/fn_recalc_stock_cap_status ต้องถูกปฏิเสธที่ระดับ grant (ไม่ใช่แค่ auth.uid() check ในฟังก์ชัน ซึ่งต้องยอมรับ auth.uid()=null เพื่อไม่พัง service-role/trigger chain)", async () => {
    const anonClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // ไม่ signInWithPassword เลย -- นี่คือ anon key เปล่าๆ ตรงตามสถานการณ์จริงของผู้โจมตีที่ไม่มี
    // account ใดๆ เลย ยิง REST RPC ตรงๆ

    const { error: e1 } = await anonClient.rpc("fn_insert_system_journal_entry", {
      p_shop_id: shopAId,
      p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `QA-SEC-108-ANON-${RUN_ID}`,
      p_source_type: "manual",
      p_source_table: null,
      p_source_id: null,
      p_lines: [
        { account_code: "1010100", debit: 1, credit: 0 },
        { account_code: "4060100", debit: 0, credit: 1 },
      ],
    });
    expect(e1, "anon (ไม่ login) ต้องถูกปฏิเสธที่ grant level").not.toBeNull();

    const { error: e2 } = await anonClient.rpc("fn_get_or_open_period", {
      p_shop_id: shopAId,
      p_date: new Date().toISOString().slice(0, 10),
    });
    expect(e2, "anon (ไม่ login) ต้องถูกปฏิเสธที่ grant level").not.toBeNull();

    const { error: e3 } = await anonClient.rpc("fn_recalc_stock_cap_status", { p_shop_id: shopAId });
    expect(e3, "anon (ไม่ login) ต้องถูกปฏิเสธที่ grant level").not.toBeNull();

    const { data: leaked } = await adminClient()
      .from("journal_entries")
      .select("entry_id")
      .eq("shop_id", shopAId)
      .like("description", "QA-SEC-108-ANON%");
    expect(leaked).toEqual([]);
  });
});
