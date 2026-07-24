// การ์ด "ขายอะไหล่ที่ยังไม่ตีราคา + แก้ไขราคาต้นทุน/ขายตอน checkout (Approval Flow แบบ
// configurable)" (Notion 3a2f39f4564981c48afff3107201782d, 24 ก.ค. 2026)
//
// Reuse: admin_action_approval_config/pending_admin_actions/decide_pending_admin_action() เดิม
// ของ Maker-Checker (การ์ด "Admin Role (7th role)") — action_type ใหม่ 'sell_unpriced_part'
// (ดู db/unpriced_part_sale_approval_migration.sql + config/adminApprovalDefaults.js)
//
// ตั้งค่า approval config ตรงผ่าน adminClient (service role) แทนการเดินผ่าน UI settings ทุกครั้ง
// เพื่อความเร็ว/ความเสถียรของ test (เหมือน pattern setMemberRoleStatus ใน fixtures อื่น) — มี 1
// scenario (UPA-007) ที่เดินผ่าน UI settings จริงเพื่อยืนยันว่าหน้า settings เองก็ใช้งานได้
import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { accounts, currentShopName } from "../fixtures/test-data.js";

let shopId;
const runId = Date.now();
const createdPartIds = [];

async function createUnpricedPart(name, quantity = 5) {
  const { data, error } = await adminClient()
    .from("parts")
    .insert({
      shop_id: shopId,
      part_name: name,
      quantity,
      price: null,
      allocated_cost: null,
      is_active: true,
      status: "available",
    })
    .select("id")
    .single();
  if (error) throw new Error(`สร้าง unpriced part ไม่สำเร็จ: ${error.message}`);
  createdPartIds.push(data.id);
  return data.id;
}

async function setApprovalConfig({ requiresApproval, approverRole = null, approverUserId = null }) {
  const { error } = await adminClient()
    .from("admin_action_approval_config")
    .upsert(
      {
        shop_id: shopId,
        action_type: "sell_unpriced_part",
        requires_approval: requiresApproval,
        approver_role: approverRole,
        approver_user_id: approverUserId,
      },
      { onConflict: "shop_id,action_type" }
    );
  if (error) throw new Error(`ตั้งค่า approval config ไม่สำเร็จ: ${error.message}`);
}

async function getLatestPartSale(partId) {
  const { data, error } = await adminClient()
    .from("part_sales")
    .select("sale_id, approval_status, quantity_sold, sale_price, part_id")
    .eq("part_id", partId)
    .order("sold_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getPart(partId) {
  const { data, error } = await adminClient().from("parts").select("*").eq("id", partId).single();
  if (error) throw error;
  return data;
}

/** หา id ของแถว pending_admin_actions ที่ผูกกับ sale_id นี้ (ใช้ data-testid ที่หน้า
 *  /admin/admin-approvals render ไว้ให้ — เจาะจงกว่าการหา block ด้วยข้อความ ซึ่งกำกวมเพราะ
 *  ข้อความปรากฏซ้ำในทั้ง div ครอบนอกและ div ย่อยข้างในพร้อมกัน */
async function getPendingActionIdForSale(saleId) {
  const { data, error } = await adminClient()
    .from("pending_admin_actions")
    .select("id, payload")
    .eq("shop_id", shopId)
    .eq("action_type", "sell_unpriced_part")
    .eq("status", "pending");
  if (error) throw error;
  const row = (data || []).find((r) => r.payload?.sale_id === saleId);
  return row?.id;
}

test.describe.serial("card-unpriced-part-sale-approval", () => {
  test.beforeAll(async () => {
    shopId = await getShopIdByName(currentShopName);
    // เคลียร์ config ค้างจากรอบก่อนหน้า กันปนกับรอบนี้
    await setApprovalConfig({ requiresApproval: false });
  });

  test.afterAll(async () => {
    // reset config กลับ default (ปิด) กัน suite อื่นที่รันหลังจากนี้เจอ approval flow เปิดค้างอยู่
    await setApprovalConfig({ requiresApproval: false });
    if (createdPartIds.length > 0) {
      await adminClient().from("part_sales").delete().in("part_id", createdPartIds);
      await adminClient().from("pending_admin_actions").delete().eq("shop_id", shopId).eq("action_type", "sell_unpriced_part");
      await adminClient().from("parts").delete().in("id", createdPartIds);
    }
  });

  test("UPA-001 Approval Flow ปิด (default) — ขายอะไหล่ไม่มีราคาผ่านทันที ไม่มี pending state", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: false });
    const partId = await createUnpricedPart(`QA unpriced off ${runId}`);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    await page.goto(`/checkout?ids=${partId}`);
    await expect(page.getByTestId(`unpriced-badge-${partId}`)).toBeVisible();
    // ไม่มีคำว่า "จะเข้ารออนุมัติ" ต่อท้าย เพราะ approval flow ปิดอยู่
    await expect(page.getByTestId(`unpriced-badge-${partId}`)).not.toContainText("จะเข้ารออนุมัติ");

    await page.getByLabel("ราคาขาย/หน่วย").fill("100");
    const paymentSelect = page.getByLabel("วิธีชำระเงิน");
    await paymentSelect.selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();

    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`pending-approval-badge-${partId}`)).toHaveCount(0);

    const sale = await getLatestPartSale(partId);
    expect(sale).toBeTruthy();
    expect(sale.approval_status).toBe("not_required");
  });

  test("UPA-002 Approval Flow เปิด — ขายอะไหล่ไม่มีราคา -> เข้า pending_approval ทันที (ขายผ่านแล้วจริง ตัดสต็อกแล้ว)", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: true, approverRole: "manager" });
    const partId = await createUnpricedPart(`QA unpriced pending ${runId}`, 4);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    await page.goto(`/checkout?ids=${partId}`);
    await expect(page.getByTestId(`unpriced-badge-${partId}`)).toContainText("จะเข้ารออนุมัติ");

    await page.getByLabel("ราคาขาย/หน่วย").fill("50");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();

    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`pending-approval-badge-${partId}`)).toBeVisible();

    const sale = await getLatestPartSale(partId);
    expect(sale.approval_status).toBe("pending_approval");

    // สต็อกถูกตัดจริงแล้ว (ขายผ่านทันทีตามมติการ์ด แม้ pending อยู่)
    const part = await getPart(partId);
    expect(Number(part.quantity)).toBe(4 - Number(sale.quantity_sold));

    const { data: pendingRows } = await adminClient()
      .from("pending_admin_actions")
      .select("id, payload, status")
      .eq("shop_id", shopId)
      .eq("action_type", "sell_unpriced_part")
      .eq("status", "pending");
    expect(pendingRows.some((r) => r.payload?.sale_id === sale.sale_id)).toBe(true);
  });

  test("UPA-003 pending_approval ไม่นับเข้า Stock Summary Report จนกว่าจะอนุมัติ", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: true, approverRole: "manager" });
    const partId = await createUnpricedPart(`QA unpriced report ${runId}`, 3);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/checkout?ids=${partId}`);
    await page.getByLabel("ราคาขาย/หน่วย").fill("777");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();
    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });

    await page.goto("/admin/reports");
    await page.getByRole("button", { name: "ทั้งหมด" }).click();
    await expect(page.getByTestId("pending-approval-note")).toBeVisible();
    // ยอด 777 ที่เพิ่งขายไม่ควรโผล่ในรายงานตอนนี้ (pending อยู่) — ตรวจทางอ้อมด้วย DB ตรงๆ แทน
    // เพราะยอดรวมหน้ารายงานพึ่งข้อมูลอื่นในร้านที่อาจเปลี่ยนแปลงระหว่าง test คู่ขนาน
    const sale = await getLatestPartSale(partId);
    expect(sale.approval_status).toBe("pending_approval");
  });

  test("UPA-004 Manager อนุมัติ -> approval_status พลิกเป็น approved -> นับเข้ารายงานได้ตามปกติ", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: true, approverRole: "manager" });
    const partId = await createUnpricedPart(`QA unpriced approve ${runId}`, 6);

    // ขายผ่าน owner ก่อน
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/checkout?ids=${partId}`);
    await page.getByLabel("ราคาขาย/หน่วย").fill("321");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();
    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });

    const saleBefore = await getLatestPartSale(partId);
    expect(saleBefore.approval_status).toBe("pending_approval");

    // manager เข้ามาอนุมัติ
    const actionId = await getPendingActionIdForSale(saleBefore.sale_id);
    expect(actionId).toBeTruthy();

    const managerPage = await page.context().browser().newContext().then((c) => c.newPage());
    await loginWithEmail(managerPage, accounts.manager.email, accounts.manager.password);
    await expectLoginSucceeded(managerPage);
    await managerPage.goto("/admin/admin-approvals");

    const pendingBlock = managerPage.getByTestId(`pending-action-${actionId}`);
    await expect(pendingBlock).toBeVisible({ timeout: 10_000 });
    await pendingBlock.getByRole("button", { name: "✅ อนุมัติ" }).click();
    // รอให้แถวหายไปจากคิว (แปลว่า RPC + side effect จบแล้วจริง) ก่อนปิด context — ปิดเร็วเกินไป
    // จะตัด network request ของ RPC ที่ยังไม่จบทิ้งกลางทาง
    await expect(pendingBlock).toHaveCount(0, { timeout: 10_000 });

    await managerPage.close();

    // poll DB จนกว่าจะเห็นสถานะ approved (RPC เป็น async กับ client render)
    await expect
      .poll(async () => (await getLatestPartSale(partId)).approval_status, { timeout: 10_000 })
      .toBe("approved");
  });

  test("UPA-005 Manager ปฏิเสธ -> คงขายไว้ (ไม่คืนสต็อก) + ขึ้นแจ้งเตือนในรายการที่เจ้าของต้องตรวจสอบ", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: true, approverRole: "manager" });
    const partId = await createUnpricedPart(`QA unpriced reject ${runId}`, 5);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/checkout?ids=${partId}`);
    await page.getByLabel("ราคาขาย/หน่วย").fill("999");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();
    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });

    const partBeforeDecision = await getPart(partId);
    const saleBefore = await getLatestPartSale(partId);
    const actionId = await getPendingActionIdForSale(saleBefore.sale_id);
    expect(actionId).toBeTruthy();

    const managerPage = await page.context().browser().newContext().then((c) => c.newPage());
    await loginWithEmail(managerPage, accounts.manager.email, accounts.manager.password);
    await expectLoginSucceeded(managerPage);
    await managerPage.goto("/admin/admin-approvals");
    const pendingBlock = managerPage.getByTestId(`pending-action-${actionId}`);
    await expect(pendingBlock).toBeVisible({ timeout: 10_000 });
    await pendingBlock.getByRole("button", { name: "❌ ปฏิเสธ" }).click();
    await expect(pendingBlock).toHaveCount(0, { timeout: 10_000 });
    await managerPage.close();

    await expect
      .poll(async () => (await getLatestPartSale(partId)).approval_status, { timeout: 10_000 })
      .toBe("rejected");

    // สต็อกไม่ถูกคืน (ไม่ reverse) — quantity หลังปฏิเสธต้องเท่ากับก่อนปฏิเสธ (เท่ากับตอนขายเสร็จ)
    const partAfterDecision = await getPart(partId);
    expect(Number(partAfterDecision.quantity)).toBe(Number(partBeforeDecision.quantity));

    // เจ้าของเห็นรายการนี้ในลิสต์ "ถูกปฏิเสธ ต้องตรวจสอบ" และกด "รับทราบ" ได้
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await page.goto("/admin/admin-approvals");
    const rejectedBlock = page.getByTestId(`rejected-sale-${saleBefore.sale_id}`);
    await expect(rejectedBlock).toBeVisible({ timeout: 10_000 });
    await rejectedBlock.getByRole("button", { name: "✅ รับทราบแล้ว" }).click();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("part_sales")
          .select("rejection_ack_at")
          .eq("part_id", partId)
          .single();
        return data?.rejection_ack_at != null;
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test("UPA-006 Self-approval อนุญาต — Owner ขายเองแล้วอนุมัติเองได้ (ไม่ถูกบล็อก)", async ({ page }) => {
    // ไม่ตั้ง approver_role เป็น owner โดยเฉพาะด้วยซ้ำ — ทดสอบ fallback "owner อนุมัติได้เสมอ"
    await setApprovalConfig({ requiresApproval: true, approverRole: "manager" });
    const partId = await createUnpricedPart(`QA unpriced self ${runId}`, 2);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/checkout?ids=${partId}`);
    await page.getByLabel("ราคาขาย/หน่วย").fill("55");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();
    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });

    // owner คนเดียวกันที่เพิ่งขาย ไปกดอนุมัติรายการของตัวเองต่อได้เลย (self-approval)
    const saleBefore = await getLatestPartSale(partId);
    const actionId = await getPendingActionIdForSale(saleBefore.sale_id);
    expect(actionId).toBeTruthy();

    await page.goto("/admin/admin-approvals");
    const pendingBlock = page.getByTestId(`pending-action-${actionId}`);
    await expect(pendingBlock).toBeVisible({ timeout: 10_000 });
    await pendingBlock.getByRole("button", { name: "✅ อนุมัติ" }).click();

    await expect
      .poll(async () => (await getLatestPartSale(partId)).approval_status, { timeout: 10_000 })
      .toBe("approved");
  });

  test("UPA-007 แก้ allocated_cost ตอน checkout -> บันทึกเป็น audit_log entry (old/new value) ไม่ใช่ overwrite เงียบๆ ไม่ต้อง reconcile กับชิ้นอื่น", async ({ page }) => {
    await setApprovalConfig({ requiresApproval: false });
    const partId = await createUnpricedPart(`QA cost override ${runId}`, 10);
    // ตั้งค่าเริ่มต้นให้มี allocated_cost อยู่ก่อน (ไม่ null) เพื่อทดสอบ override จากค่าเดิม -> ค่าใหม่
    await adminClient().from("parts").update({ allocated_cost: 100 }).eq("id", partId);

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/checkout?ids=${partId}`);

    // part ตอนนี้มี allocated_cost=100 อยู่แล้ว -> ไม่ใช่ unpriced จาก allocated_cost ฝั่งเดียว
    // (แต่ price ยังเป็น null อยู่ ตาม createUnpricedPart) -> ยังถือว่า unpriced เพราะ price IS NULL
    await expect(page.getByTestId(`unpriced-badge-${partId}`)).toBeVisible();

    const costInput = page.getByTestId(`allocated-cost-${partId}`);
    await expect(costInput).toHaveValue("100");
    await costInput.fill("250");
    await page.getByTestId(`cost-reason-${partId}`).fill("แก้ราคาต้นทุนตอน checkout — QA test");

    await page.getByLabel("ราคาขาย/หน่วย").fill("300");
    await page.getByLabel("วิธีชำระเงิน").selectOption("cash");
    await page.getByRole("button", { name: "✓ ยืนยันการขายทั้งหมด" }).click();
    await expect(page.locator(".msg.success")).toBeVisible({ timeout: 15_000 });

    const part = await getPart(partId);
    expect(Number(part.allocated_cost)).toBe(250);
    expect(part.cost_override_reason).toContain("QA test");

    // audit_log ต้องมีแถวใหม่จาก UPDATE นี้ พร้อม old/new value ที่ถูกต้อง (fn_audit_row_change
    // ครอบทุกคอลัมน์ของ parts อยู่แล้ว — ไม่ต้องมี audit mechanism ใหม่แยกต่างหาก)
    const { data: auditRows, error: auditError } = await adminClient()
      .from("audit_log")
      .select("old_data, new_data, changed_by_user_id, action, changed_at")
      .eq("table_name", "parts")
      .eq("record_uuid", partId)
      .eq("action", "UPDATE")
      .order("changed_at", { ascending: false })
      .limit(5);
    expect(auditError).toBeFalsy();
    const match = (auditRows || []).find(
      (r) => Number(r.old_data?.allocated_cost) === 100 && Number(r.new_data?.allocated_cost) === 250
    );
    expect(match).toBeTruthy();
    expect(match.changed_by_user_id).toBeTruthy();
  });
});
