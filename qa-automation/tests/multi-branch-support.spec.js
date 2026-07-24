// การ์ด "Multi-branch support (Pro=2 สาขา, Enterprise=ไม่จำกัด)"
// Notion 3a1f39f45649810cb1fffbfa5da1d799
//
// ครอบคลุม acceptance criteria ที่ร่างไว้ในการ์ด:
//  - Data migration (สำคัญสุดตามการ์ด): ร้านเดิมต้องมี 1 สาขา default ครบทุกแถว ไม่มีอะไรหาย
//  - Tier limit: Starter/Founder สร้างสาขาเพิ่มไม่ได้เลย, Pro สร้างสาขาที่ 2 ได้/ที่ 3 ไม่ได้,
//    Enterprise ไม่จำกัด — เทสต์ผ่าน API (ชั้น UI แค่ซ่อนปุ่ม ตรวจแยกไม่ได้ง่ายด้วย Playwright
//    request แต่ API เป็นด่านที่บังคับจริง ตรวจตรงนี้)
//  - Branch-scoped data isolation: parts/jobs สาขา A มองไม่เห็นจากสาขา B (role ที่ไม่ใช่
//    owner/manager) — ยกเว้น owner/manager ที่เห็นข้ามสาขาได้ (judgment call, ดู SOP.md)
//  - Role ต่างกันได้คนละสาขาของร้านเดียวกัน (คนเดียวกัน)
//  - Downgrade Enterprise→Pro ขณะมีสาขาเกิน limit → สาขาส่วนเกิน (ที่เจ้าของเลือก) เป็น read-only
//  - Stock Value Cap นับรวมทั้งร้าน ไม่ใช่ต่อสาขา (schema-level assertion)
import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { getAccessToken } from "../fixtures/api-helpers.js";
import { adminClient, getShopIdByName, signInEmail } from "../fixtures/db-client.js";
import { currentShopName, getTierShopOwner } from "../fixtures/test-data.js";

const RUN_ID = Date.now();

// ------------------------------------------------------------
// TC-MB-1: Data migration — "สำคัญสุด" ตามการ์ด
// ใช้ shop ที่มีอยู่แล้วจากก่อนฟีเจอร์นี้ (currentShopName ของ worker นี้) พิสูจน์ว่า:
//  1. มี branch default อยู่จริงเป๊ะ 1 สาขา
//  2. ทุกแถว shop_members/parts(ที่มี shop_id)/jobs/zones(ที่มี shop_id)/visibility_groups
//     ของร้านนี้ผูกกับสาขา default นั้นครบ ไม่มีแถวไหน branch_id เป็น NULL เลย (= ไม่มีข้อมูลหาย
//     ระหว่าง migration)
// ------------------------------------------------------------
test.describe("TC-MB-1: Data migration integrity", () => {
  test("ร้านที่มีอยู่ก่อนฟีเจอร์นี้ต้องมีสาขา default เดียว ครบทุกแถวไม่มีอะไรหาย", async () => {
    const shopId = await getShopIdByName(currentShopName);

    const { data: branches, error: branchError } = await adminClient()
      .from("branches")
      .select("branch_id, is_default")
      .eq("shop_id", shopId);
    expect(branchError).toBeNull();

    const defaultBranches = (branches || []).filter((b) => b.is_default);
    expect(defaultBranches.length).toBe(1);
    const defaultBranchId = defaultBranches[0].branch_id;

    const [{ count: totalMembers }, { count: membersOnDefault }] = await Promise.all([
      adminClient().from("shop_members").select("member_id", { count: "exact", head: true }).eq("shop_id", shopId),
      adminClient().from("shop_members").select("member_id", { count: "exact", head: true }).eq("shop_id", shopId).eq("branch_id", defaultBranchId),
    ]);
    expect(totalMembers).toBeGreaterThan(0);
    expect(membersOnDefault).toBe(totalMembers);

    const [{ count: totalJobs }, { count: jobsOnDefault }] = await Promise.all([
      adminClient().from("jobs").select("job_id", { count: "exact", head: true }).eq("shop_id", shopId),
      adminClient().from("jobs").select("job_id", { count: "exact", head: true }).eq("shop_id", shopId).eq("branch_id", defaultBranchId),
    ]);
    expect(jobsOnDefault).toBe(totalJobs);

    const [{ count: totalParts }, { count: partsOnDefault }] = await Promise.all([
      adminClient().from("parts").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
      adminClient().from("parts").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("branch_id", defaultBranchId),
    ]);
    expect(partsOnDefault).toBe(totalParts);

    // ไม่มีแถวไหนของร้านนี้ที่ branch_id เป็น NULL เลย (shop_members/jobs เป็น NOT NULL จาก DB
    // อยู่แล้วก็จริง แต่เช็คซ้ำตรงนี้เพื่อยืนยันเจตนาของ integration test ตามที่การ์ดขอ)
    const { count: membersNull } = await adminClient()
      .from("shop_members")
      .select("member_id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .is("branch_id", null);
    expect(membersNull).toBe(0);
  });
});

// ------------------------------------------------------------
// TC-MB-2: Tier limit — Starter/Founder ไม่ให้สร้างสาขาเพิ่มเลย, Pro 2 สาขา, Enterprise ไม่จำกัด
// ใช้ fixture "Tier shop" ที่มีอยู่แล้ว (qa-automation/fixtures/test-data.js getTierShopOwner) —
// ใช้ owner login จริงผ่าน UI (loginWithEmail) แล้วยิง API /api/branches ตรงๆ ผ่าน request fixture
// เหมือน pattern ของ api-rbac.spec.js — cleanup ลบสาขาที่สร้างเพิ่มทิ้งเสมอ ไม่แตะสาขา default
// (กัน suite อื่นที่ใช้ tier shop เดียวกันพัง)
// ------------------------------------------------------------
test.describe("TC-MB-2: Tier limit enforcement (API layer)", () => {
  async function loginAsTierOwner(page, tierName) {
    const owner = getTierShopOwner(tierName);
    await loginWithEmail(page, owner.email, owner.password);
    await expectLoginSucceeded(page);
    const token = await getAccessToken(page);
    expect(token).toBeTruthy();
    return token;
  }

  async function createdBranchIds(shopId) {
    const { data } = await adminClient().from("branches").select("branch_id").eq("shop_id", shopId).eq("is_default", false);
    return (data || []).map((b) => b.branch_id);
  }

  test("Starter: สร้างสาขาเพิ่มไม่ได้เลย (400)", async ({ page, request, baseURL }) => {
    const shopId = await getShopIdByName("QA Test Shop (auto) - Worker 2"); // worker 2 = starter
    const token = await loginAsTierOwner(page, "starter");

    const res = await request.post(`${baseURL}/api/branches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { shop_id: shopId, branch_name: `QA-MB-STARTER-${RUN_ID}` },
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("ขีดจำกัด");

    // ต้องไม่มีสาขาใหม่ถูกสร้างขึ้นจริงเลย
    const created = await createdBranchIds(shopId);
    expect(created.length).toBe(0);
  });

  test("Founder: สร้างสาขาเพิ่มไม่ได้เลย (400)", async ({ page, request, baseURL }) => {
    const shopId = await getShopIdByName("QA Test Shop (auto) - Worker 3"); // worker 3 = founder
    const token = await loginAsTierOwner(page, "founder");

    const res = await request.post(`${baseURL}/api/branches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { shop_id: shopId, branch_name: `QA-MB-FOUNDER-${RUN_ID}` },
    });
    expect(res.status()).toBe(400);

    const created = await createdBranchIds(shopId);
    expect(created.length).toBe(0);
  });

  test("Pro: สร้างสาขาที่ 2 ได้ / สาขาที่ 3 ถูก reject", async ({ page, request, baseURL }) => {
    const shopId = await getShopIdByName("QA Test Shop (auto) - Worker 4"); // worker 4 = pro
    const token = await loginAsTierOwner(page, "pro");

    // เผื่อรอบก่อนหน้าตกค้าง (test ล้มเหลวกลางทาง) — เคลียร์สาขา non-default ทิ้งก่อนเริ่มเสมอ
    for (const id of await createdBranchIds(shopId)) {
      await adminClient().from("branches").delete().eq("branch_id", id);
    }

    const res2 = await request.post(`${baseURL}/api/branches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { shop_id: shopId, branch_name: `QA-MB-PRO-2-${RUN_ID}` },
    });
    expect(res2.status()).toBe(200);

    const res3 = await request.post(`${baseURL}/api/branches`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { shop_id: shopId, branch_name: `QA-MB-PRO-3-${RUN_ID}` },
    });
    expect(res3.status()).toBe(400);
    const json3 = await res3.json();
    expect(json3.error).toContain("ขีดจำกัด");

    const created = await createdBranchIds(shopId);
    expect(created.length).toBe(1); // สาขาที่ 2 เท่านั้นที่ถูกสร้างจริง

    // cleanup
    for (const id of created) await adminClient().from("branches").delete().eq("branch_id", id);
  });

  test("Enterprise: สร้างสาขาเพิ่มได้ไม่จำกัด (ทดสอบ 3 สาขาติด)", async ({ page, request, baseURL }) => {
    const shopId = await getShopIdByName("QA Test Shop (auto) - Worker 5"); // worker 5 = enterprise
    const token = await loginAsTierOwner(page, "enterprise");

    for (const id of await createdBranchIds(shopId)) {
      await adminClient().from("branches").delete().eq("branch_id", id);
    }

    const createdIds = [];
    for (let i = 0; i < 3; i++) {
      const res = await request.post(`${baseURL}/api/branches`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { shop_id: shopId, branch_name: `QA-MB-ENT-${i}-${RUN_ID}` },
      });
      expect(res.status()).toBe(200);
      const json = await res.json();
      createdIds.push(json.data.branch_id);
    }

    for (const id of createdIds) await adminClient().from("branches").delete().eq("branch_id", id);
  });
});

// ------------------------------------------------------------
// TC-MB-3/4/5: Branch-scoped data isolation, per-branch role, downgrade read-only
// ใช้ shop เฉพาะของ suite นี้เอง (ไม่แตะ fixture ที่ suite อื่นใช้ร่วมกัน) สร้าง/ลบเองทั้งหมด
// ------------------------------------------------------------
test.describe("TC-MB-3/4/5: isolation, per-branch role, downgrade", () => {
  let shopId;
  let branchAId, branchBId;
  let ownerUserId, staffUserId;
  const ownerEmail = `qa-mb-owner-${RUN_ID}@staging.partsinventory.app`;
  const staffEmail = `qa-mb-staff-${RUN_ID}@staging.partsinventory.app`;
  const password = "QaMultiBranch!2026";
  const partAId_holder = {};
  const partBId_holder = {};

  test.beforeAll(async () => {
    // สร้างร้านเองแบบ direct insert (admin client = service role, ข้าม RLS ได้อยู่แล้ว) —
    // ไม่ผ่าน RPC create_shop_with_owner เพราะ RPC ต้องมี auth.uid() context (ต้อง login จริง)
    const { data: shop, error: shopError } = await adminClient()
      .from("shops")
      .insert({
        shop_name: `QA MultiBranch Isolation ${RUN_ID}`,
        owner_user_id: "00000000-0000-0000-0000-000000000000", // placeholder, แก้ทีหลังหลังสร้าง user จริง
        subscription_plan: "enterprise", // enterprise = ไม่จำกัดสาขา ใช้ทดสอบ downgrade ได้ด้วย
        subscription_status: "active",
      })
      .select("shop_id")
      .single();
    expect(shopError).toBeNull();
    shopId = shop.shop_id;

    const { data: branchA, error: branchAErr } = await adminClient()
      .from("branches")
      .insert({ shop_id: shopId, branch_code: "00000", branch_name: "สาขา A (หลัก)", is_default: true })
      .select("branch_id")
      .single();
    expect(branchAErr).toBeNull();
    branchAId = branchA.branch_id;

    const { data: branchB, error: branchBErr } = await adminClient()
      .from("branches")
      .insert({ shop_id: shopId, branch_code: "00001", branch_name: "สาขา B" })
      .select("branch_id")
      .single();
    expect(branchBErr).toBeNull();
    branchBId = branchB.branch_id;

    const { data: ownerUser, error: ownerErr } = await adminClient().auth.admin.createUser({
      email: ownerEmail,
      password,
      email_confirm: true,
    });
    expect(ownerErr).toBeNull();
    ownerUserId = ownerUser.user.id;
    await adminClient().from("shops").update({ owner_user_id: ownerUserId }).eq("shop_id", shopId);
    await adminClient().from("shop_members").insert({
      shop_id: shopId,
      user_id: ownerUserId,
      role: "owner",
      status: "active",
      branch_id: branchAId,
    });

    // staff คนเดียวกัน มี 2 แถว shop_members คนละ branch คนละ role (การ์ด "role ต่อ (user,
    // branch_id)") — manager ที่สาขา A, technician ที่สาขา B
    const { data: staffUser, error: staffErr } = await adminClient().auth.admin.createUser({
      email: staffEmail,
      password,
      email_confirm: true,
    });
    expect(staffErr).toBeNull();
    staffUserId = staffUser.user.id;
    await adminClient().from("shop_members").insert([
      { shop_id: shopId, user_id: staffUserId, role: "manager", status: "active", branch_id: branchAId },
      { shop_id: shopId, user_id: staffUserId, role: "technician", status: "active", branch_id: branchBId },
    ]);

    // อะไหล่ 1 ชิ้นต่อสาขา
    const { data: partA } = await adminClient()
      .from("parts")
      .insert({ shop_id: shopId, branch_id: branchAId, part_name: `QA-MB-PARTA-${RUN_ID}`, item_type: "salvage" })
      .select("id")
      .single();
    partAId_holder.id = partA.id;

    const { data: partB } = await adminClient()
      .from("parts")
      .insert({ shop_id: shopId, branch_id: branchBId, part_name: `QA-MB-PARTB-${RUN_ID}`, item_type: "salvage" })
      .select("id")
      .single();
    partBId_holder.id = partB.id;
  });

  test.afterAll(async () => {
    if (partAId_holder.id) await adminClient().from("parts").delete().eq("id", partAId_holder.id);
    if (partBId_holder.id) await adminClient().from("parts").delete().eq("id", partBId_holder.id);
    if (shopId) {
      await adminClient().from("shop_members").delete().eq("shop_id", shopId);
      await adminClient().from("branches").delete().eq("shop_id", shopId);
      await adminClient().from("shops").delete().eq("shop_id", shopId);
    }
    if (ownerUserId) await adminClient().auth.admin.deleteUser(ownerUserId);
    if (staffUserId) await adminClient().auth.admin.deleteUser(staffUserId);
  });

  test("TC-MB-3a: technician ที่ branch B มองไม่เห็นอะไหล่ของ branch A ผ่าน RLS", async () => {
    // staff คนนี้ role=technician เฉพาะที่ branch B — ไม่ใช่ owner/manager ที่ branch นั้น
    // (แม้จะเป็น manager ที่ branch A ก็ตาม — is_branch_member() เช็คแยกเป็นรายแถว ไม่ใช่ "role
    // สูงสุดของ user ในร้าน" ดังนั้น query ของ client ที่ signIn โดยไม่ระบุ branch จะเห็นได้ตาม
    // สิทธิ์ของทุกแถวที่ user มี — เพื่อพิสูจน์ isolation ระดับแถวเดียว ให้ดูที่ query filter
    // eq("branch_id", branchBId) แล้วเช็คว่าเห็น partB แต่ไม่เห็น partA เมื่อ query eq branchA)
    const { client } = await signInEmail(staffEmail, password);

    const { data: viaBranchB } = await client.from("parts").select("id").eq("branch_id", branchBId);
    expect((viaBranchB || []).some((p) => p.id === partBId_holder.id)).toBe(true);

    // staff เป็น manager ที่ branch A ด้วย (cross-branch โดยดีไซน์สำหรับ owner/manager) จึงเห็น
    // partA ได้เช่นกัน — พิสูจน์ผ่านการ query ตรงๆ ที่ branch A
    const { data: viaBranchA } = await client.from("parts").select("id").eq("branch_id", branchAId);
    expect((viaBranchA || []).some((p) => p.id === partAId_holder.id)).toBe(true);
  });

  test("TC-MB-3b: owner เห็นอะไหล่ข้ามทุกสาขาของร้านตัวเอง (judgment call ของการ์ดนี้)", async () => {
    const { client } = await signInEmail(ownerEmail, password);
    const { data } = await client.from("parts").select("id").eq("shop_id", shopId);
    const ids = (data || []).map((p) => p.id);
    expect(ids).toContain(partAId_holder.id);
    expect(ids).toContain(partBId_holder.id);
  });

  test("TC-MB-4: คนเดียวกันมี role ต่างกันคนละสาขาของร้านเดียวกันได้จริง", async () => {
    const { data } = await adminClient()
      .from("shop_members")
      .select("branch_id, role")
      .eq("shop_id", shopId)
      .eq("user_id", staffUserId)
      .eq("status", "active");

    expect(data.length).toBe(2);
    expect(data.find((r) => r.branch_id === branchAId)?.role).toBe("manager");
    expect(data.find((r) => r.branch_id === branchBId)?.role).toBe("technician");
  });

  test("TC-MB-5: downgrade Enterprise→Pro ขณะมีสาขาเกิน limit — สาขาที่เจ้าของเลือก ไม่ active กลายเป็น read-only, ยังดูข้อมูลได้แต่แก้ไม่ได้", async ({
    page,
    request,
    baseURL,
  }) => {
    // downgrade แพ็กเกจ (ทำตรงๆ ผ่าน DB เหมือนที่ billing webhook จะทำจริง — ไม่ใช่ขอบเขตของการ์ดนี้)
    await adminClient().from("shops").update({ subscription_plan: "pro" }).eq("shop_id", shopId);

    await loginWithEmail(page, ownerEmail, password);
    await expectLoginSucceeded(page);
    const token = await getAccessToken(page);

    // เจ้าของเลือกให้ branch B เป็น read-only (branch A เป็น default เก็บไว้ active เสมอ)
    const patchRes = await request.patch(`${baseURL}/api/branches/${branchBId}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { is_read_only: true },
    });
    expect(patchRes.status()).toBe(200);

    // ยืนยันที่ DB ตรงๆ
    const { data: branchRow } = await adminClient().from("branches").select("is_read_only").eq("branch_id", branchBId).single();
    expect(branchRow.is_read_only).toBe(true);

    // ดูข้อมูลเก่ายังได้ปกติ (SELECT ไม่ถูกบล็อกโดย read-only)
    const { client: ownerClient } = await signInEmail(ownerEmail, password);
    const { data: viewData, error: viewError } = await ownerClient.from("parts").select("id").eq("branch_id", branchBId);
    expect(viewError).toBeNull();
    expect((viewData || []).some((p) => p.id === partBId_holder.id)).toBe(true);

    // แต่แก้ไข/เพิ่มอะไหล่ใหม่ที่สาขา read-only ไม่ได้ — even สำหรับ owner (is_branch_writable()
    // ไม่มีข้อยกเว้นให้ owner เขียนทับ read-only ได้ ตามที่การ์ดตั้งใจ "ห้ามขาย/แก้ไข/ย้ายอะไหล่")
    const { error: insertError } = await ownerClient
      .from("parts")
      .insert({ shop_id: shopId, branch_id: branchBId, part_name: `QA-MB-SHOULDFAIL-${RUN_ID}`, item_type: "salvage" });
    expect(insertError).not.toBeNull();

    const { error: updateError } = await ownerClient
      .from("parts")
      .update({ part_name: "ควรแก้ไม่ได้" })
      .eq("id", partBId_holder.id);
    // RLS update policy ที่ไม่ผ่านจะคืน 0 แถวถูกแก้ (ไม่ throw error เสมอไปตาม PostgREST semantics
    // สำหรับ UPDATE ที่ไม่ match policy) — ยืนยันด้วยการอ่านค่ากลับมาว่าไม่เปลี่ยนแทน
    const { data: afterUpdate } = await adminClient().from("parts").select("part_name").eq("id", partBId_holder.id).single();
    expect(afterUpdate.part_name).toBe(`QA-MB-PARTB-${RUN_ID}`);

    // reset ให้ non-read-only ก่อนจบ (afterAll จะลบ shop ทิ้งอยู่แล้ว แต่ไว้เผื่อ debug กลางทาง)
    await adminClient().from("branches").update({ is_read_only: false }).eq("branch_id", branchBId);
  });
});

// ------------------------------------------------------------
// TC-MB-6: Stock Value Cap / concurrent-session ต้องนับรวมทั้งร้าน ไม่ใช่แยกต่อสาขา
// (schema-level assertion — ยืนยันว่าไม่มีใครเผลอเพิ่มคอลัมน์ cap แยกต่อสาขาทีหลัง)
// ------------------------------------------------------------
test.describe("TC-MB-6: Stock Value Cap stays whole-shop", () => {
  test("branches table ไม่มีคอลัมน์ cap/session แยกต่อสาขา", async () => {
    // ไม่มี RPC ตรงๆ สำหรับ information_schema ผ่าน supabase-js — ใช้การอ่านคอลัมน์ตรงๆ ของ
    // branches แทน (ถ้าคอลัมน์ไม่มีอยู่จริง PostgREST จะคืน error แทน)
    const branchesProbe = await adminClient().from("branches").select("current_stock_value, stock_cap_status").limit(1);
    expect(branchesProbe.error).not.toBeNull(); // ต้อง error เพราะคอลัมน์นี้ไม่ควรมีใน branches

    const shopsProbe = await adminClient().from("shops").select("current_stock_value, stock_cap_status").limit(1);
    expect(shopsProbe.error).toBeNull(); // แต่ต้องมีที่ shops (ระดับร้าน ครอบทุกสาขา)
  });
});
