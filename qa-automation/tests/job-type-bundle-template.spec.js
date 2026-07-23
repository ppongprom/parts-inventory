// ------------------------------------------------------------
// Job Type Bundle Template — feature ใหม่ทั้งหมด (built this session, ยังไม่มี coverage เลย)
// อ้างอิง selector จาก source code จริง:
//   components/JobTypeBundleConfirmModal.js — modal "สร้างเซตใหม่"
//   app/jobs/[id]/page.js                   — กล่องค้นหารวม + การ์ดยืนยัน "ใช้เซตนี้" ในหน้างาน
//   app/admin/job-type-bundles/page.js      — หน้า admin จัดการเซตที่มีอยู่แล้ว
// ถ้า markup เปลี่ยน ให้แก้ selector ที่นี่ให้ตรงโค้ดจริงเสมอ (ห้ามเดา)
// ------------------------------------------------------------
import { test, expect } from "@playwright/test";
import { loginWithEmail, loginWithStaffPin, expectLoginSucceeded, expectRoleForbidden } from "../fixtures/auth-helpers.js";
import { adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { accounts } from "../fixtures/test-data.js";

let mainShopId;
let testJobId;
let testPartId;
const createdTemplateIds = [];
const createdCostItemJobIds = new Set(); // แค่ track ว่า testJobId มี cost item ที่ต้อง cleanup (เดี๋ยวลบทั้งงานทีเดียว)

function uniqueName(prefix) {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

test.beforeAll(async () => {
  mainShopId = await getShopIdByName("QA Test Shop (auto)");

  // งานทดสอบสำหรับผูก cost item / workflow step ตลอดทั้งไฟล์นี้ — insert ตรงผ่าน service role
  // (mirror ของ insert ใน app/jobs/new/page.js: shop_id + status="received" พอสำหรับงานเปล่า)
  const { data: job, error: jobError } = await adminClient()
    .from("jobs")
    .insert({ shop_id: mainShopId, status: "received", customer_name: "QA Bundle Template Test Job" })
    .select("job_id")
    .single();
  if (jobError) throw jobError;
  testJobId = job.job_id;

  // อะไหล่ตัวอย่างในสต็อกร้านทดสอบ สำหรับเทส "ผูกกับสต็อก" — ต้อง item_type ใน
  // (consumable, salvage) + is_active=true + quantity>0 ถึงจะโผล่ในผลค้นหาของ modal (ดู searchParts
  // ใน components/JobTypeBundleConfirmModal.js)
  const { data: part, error: partError } = await adminClient()
    .from("parts")
    .insert({
      shop_id: mainShopId,
      part_name: uniqueName("QA Bundle Stock Part"),
      item_type: "consumable",
      is_active: true,
      quantity: 5,
      price: 320,
    })
    .select("id, part_name")
    .single();
  if (partError) throw partError;
  testPartId = part;
});

test.afterAll(async () => {
  // ลบเซตทั้งหมดที่สร้างในไฟล์นี้ — cascade ลบ job_type_bundle_items / _item_variants / _steps ให้เอง
  // (FK "on delete cascade" ตามที่กำหนดใน db/job_type_bundle_steps_migration.sql และตาราง items/variants
  // ที่สร้างมาพร้อมกัน)
  for (const templateId of createdTemplateIds) {
    await adminClient().from("job_type_bundle_templates").delete().eq("template_id", templateId);
  }
  if (testJobId) {
    await adminClient().from("job_cost_items").delete().eq("job_id", testJobId);
    await adminClient().from("job_workflow_steps").delete().eq("job_id", testJobId);
    await adminClient().from("jobs").delete().eq("job_id", testJobId);
  }
  if (testPartId) {
    await adminClient().from("parts").delete().eq("id", testPartId.id);
  }
});

/** ค้นหาคำใน "ช่องค้นหารวม" ของหน้างาน (placeholder ตรงจาก app/jobs/[id]/page.js) */
async function searchOnJobPage(page, query) {
  const searchBox = page.getByPlaceholder("รายละเอียด — พิมพ์ชื่องาน/อะไหล่/รายการที่เคยใช้ ('ค่า...' = ค่าแรงอัตโนมัติ)");
  await searchBox.fill(query);
  return searchBox;
}

/** สร้างเซตตรงผ่าน DB (สำหรับเทสที่ต้องการเซตที่มีอยู่แล้วแบบ deterministic ไม่พึ่ง UI) */
async function createBundleTemplateViaDb({ jobTypeName, items, steps = [] }) {
  const { data: template, error: templateError } = await adminClient()
    .from("job_type_bundle_templates")
    .insert({ shop_id: mainShopId, job_type_name: jobTypeName })
    .select("template_id")
    .single();
  if (templateError) throw templateError;
  createdTemplateIds.push(template.template_id);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const { data: insertedItem, error: itemError } = await adminClient()
      .from("job_type_bundle_items")
      .insert({
        template_id: template.template_id,
        category: item.category || "parts",
        item_group_label: item.item_group_label,
        description: item.description,
        default_amount: item.default_amount ?? null,
        default_quantity: item.default_quantity ?? 1,
        is_price_locked: true,
        sort_order: i,
      })
      .select("item_id")
      .single();
    if (itemError) throw itemError;

    if (item.variants && item.variants.length > 0) {
      const variantRows = item.variants.map((v, vi) => ({
        item_id: insertedItem.item_id,
        variant_label: v.variant_label,
        description: v.description,
        default_amount: v.default_amount ?? null,
        default_quantity: v.default_quantity ?? 1,
        sort_order: vi,
      }));
      const { error: variantError } = await adminClient().from("job_type_bundle_item_variants").insert(variantRows);
      if (variantError) throw variantError;
    }
  }

  if (steps.length > 0) {
    const { error: stepsError } = await adminClient()
      .from("job_type_bundle_steps")
      .insert(steps.map((name, i) => ({ template_id: template.template_id, step_name: name, sort_order: i })));
    if (stepsError) throw stepsError;
  }

  return template.template_id;
}

test.describe("BUNDLE-001 — RBAC: ปุ่ม \"+ สร้างชุดใหม่\" ในหน้างาน", () => {
  test("Owner เห็นปุ่ม \"+ สร้างชุดใหม่\" เมื่อค้นหาชื่อประเภทงานที่ไม่มีเซตตรงกัน", async ({ page }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const query = uniqueName("QA ไม่มีเซตนี้แน่นอน");
    await searchOnJobPage(page, query);
    await expect(page.getByRole("button", { name: new RegExp(`\\+ สร้างชุดใหม่ "${query}"`) })).toBeVisible({
      timeout: 8_000,
    });
  });

  test("Manager เห็นปุ่ม \"+ สร้างชุดใหม่\" เช่นกัน", async ({ page }) => {
    await loginWithEmail(page, accounts.manager.email, accounts.manager.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const query = uniqueName("QA ไม่มีเซตนี้แน่นอน");
    await searchOnJobPage(page, query);
    await expect(page.getByRole("button", { name: new RegExp(`\\+ สร้างชุดใหม่ "${query}"`) })).toBeVisible({
      timeout: 8_000,
    });
  });

  test("Technician ไม่เห็นปุ่ม \"+ สร้างชุดใหม่\" เลย ไม่ว่าจะค้นหาชื่ออะไร (เลือกจาก preset ที่มีอยู่แล้วเสมอ)", async ({
    page,
  }) => {
    await loginWithStaffPin(page, accounts.technician.username, accounts.technician.pin);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const query = uniqueName("QA ไม่มีเซตนี้แน่นอน");
    await searchOnJobPage(page, query);
    // รอให้ query ยิงจริงก่อน (เช็คว่าไม่มี dropdown ผลลัพธ์เซตงานโผล่มา) แล้วค่อยยืนยันว่าไม่มีปุ่มสร้าง
    await expect(page.getByText("🧰 เซตงาน")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /\+ สร้างชุดใหม่/ })).toHaveCount(0);
  });
});

test.describe("BUNDLE-002 — สร้างเซตใหม่จากหน้างาน แล้วนำไปใช้ทันที", () => {
  test("กรอก 1 รายการ + 1 sub-variant + 2 ขั้นตอน แล้วบันทึก -> เพิ่ม cost item และขั้นตอนแบบยังไม่มอบหมาย", async ({
    page,
  }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const { count: costCountBefore } = await adminClient()
      .from("job_cost_items")
      .select("*", { count: "exact", head: true })
      .eq("job_id", testJobId);
    const { count: stepCountBefore } = await adminClient()
      .from("job_workflow_steps")
      .select("*", { count: "exact", head: true })
      .eq("job_id", testJobId);

    const jobTypeName = uniqueName("QA เปลี่ยนถ่ายน้ำมันเกียร์");
    await searchOnJobPage(page, jobTypeName);
    await page.getByRole("button", { name: new RegExp(`\\+ สร้างชุดใหม่ "${jobTypeName}"`) }).click();

    const modal = page.locator(".job-bundle-modal");
    await expect(modal).toBeVisible();
    await expect(modal.getByPlaceholder("เช่น เปลี่ยนถ่ายน้ำมันเครื่อง")).toHaveValue(jobTypeName);

    // รายการหลัก
    await modal.getByPlaceholder("ชื่อรายการ เช่น น้ำมันเกียร์").fill("น้ำมันเกียร์ CVT");
    await modal.getByPlaceholder("รายละเอียด default").fill("น้ำมันเกียร์ CVT แท้ศูนย์");
    await modal.getByPlaceholder("ราคา", { exact: true }).fill("450");

    // sub-variant 1 ตัว
    await modal.getByRole("button", { name: "+ เพิ่ม sub-variant" }).click();
    await modal.getByPlaceholder("ชื่อ sub-variant เช่น CVT").fill("CVT");
    await modal.getByPlaceholder("รายละเอียด").fill("น้ำมันเกียร์ CVT ยี่ห้อ A");
    // ปริมาณ/ราคา ของ sub-variant (default_quantity="1" มาแล้ว แก้ราคาเฉยๆ)
    await modal.locator('input[placeholder="ราคา"]').fill("480");

    // 2 ขั้นตอนการทำงาน
    await modal.getByRole("button", { name: "+ เพิ่มขั้นตอน" }).click();
    await modal.getByPlaceholder("เช่น รื้อตรวจสภาพ").nth(0).fill("ถ่ายน้ำมันเกียร์เก่า");
    await modal.getByRole("button", { name: "+ เพิ่มขั้นตอน" }).click();
    await modal.getByPlaceholder("เช่น รื้อตรวจสภาพ").nth(1).fill("เติมน้ำมันเกียร์ใหม่");

    await modal.getByRole("button", { name: "บันทึกเซตนี้" }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    const { data: template } = await adminClient()
      .from("job_type_bundle_templates")
      .select("template_id")
      .eq("shop_id", mainShopId)
      .eq("job_type_name", jobTypeName)
      .single();
    expect(template).toBeTruthy();
    createdTemplateIds.push(template.template_id);

    const { data: costItems, count: costCountAfter } = await adminClient()
      .from("job_cost_items")
      .select("*", { count: "exact" })
      .eq("job_id", testJobId);
    expect(costCountAfter).toBe((costCountBefore || 0) + 1);
    const addedCostItem = costItems.find((c) => c.description === "น้ำมันเกียร์ CVT ยี่ห้อ A");
    expect(addedCostItem).toBeTruthy();
    expect(addedCostItem.category).toBe("parts");
    expect(Number(addedCostItem.amount)).toBe(480); // unit price 480 x quantity 1

    const { data: steps, count: stepCountAfter } = await adminClient()
      .from("job_workflow_steps")
      .select("*", { count: "exact" })
      .eq("job_id", testJobId);
    expect(stepCountAfter).toBe((stepCountBefore || 0) + 2);
    const newSteps = steps.filter((s) => ["ถ่ายน้ำมันเกียร์เก่า", "เติมน้ำมันเกียร์ใหม่"].includes(s.step_name));
    expect(newSteps).toHaveLength(2);
    // hard requirement: preset ขั้นตอนต้องไม่ผูกคนรับผิดชอบมาด้วยเด็ดขาด
    for (const s of newSteps) {
      expect(s.assigned_to).toBeNull();
    }

    // ตรวจใน UI ด้วยว่าขั้นตอนใหม่โผล่แบบ "ยังไม่มอบหมาย" ในหน้างาน
    await expect(page.getByText("ถ่ายน้ำมันเกียร์เก่า")).toBeVisible();
    await expect(page.getByText("เติมน้ำมันเกียร์ใหม่")).toBeVisible();
  });
});

test.describe("BUNDLE-003 — ใช้เซตที่มีอยู่แล้วจากกล่องค้นหา", () => {
  test("ค้นหาเซตที่มีอยู่ -> เห็นใต้หัว \"🧰 เซตงาน\" -> เลือก -> การ์ดยืนยันแสดงรายการ+preview ขั้นตอน -> กด \"✅ ใช้เซตนี้\" เพิ่ม cost item/steps ต่อท้าย", async ({
    page,
  }) => {
    const jobTypeName = uniqueName("QA เช็คระยะ 10000 กม");
    await createBundleTemplateViaDb({
      jobTypeName,
      items: [
        {
          category: "labor",
          item_group_label: "ค่าแรงเช็คระยะ",
          description: "ค่าแรงเช็คระยะ 10000 กม.",
          default_amount: 200,
          default_quantity: 1,
        },
      ],
      steps: ["ตรวจเช็คทั่วไป"],
    });

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const { count: costCountBefore } = await adminClient()
      .from("job_cost_items")
      .select("*", { count: "exact", head: true })
      .eq("job_id", testJobId);
    const { count: stepCountBefore } = await adminClient()
      .from("job_workflow_steps")
      .select("*", { count: "exact", head: true })
      .eq("job_id", testJobId);

    await searchOnJobPage(page, jobTypeName);
    await expect(page.getByText("🧰 เซตงาน")).toBeVisible({ timeout: 8_000 });
    await page.getByRole("button", { name: new RegExp(`🧰 ${jobTypeName}`) }).click();

    await expect(page.getByText(`🧰 ${jobTypeName}`)).toBeVisible();
    await expect(page.getByText("ค่าแรง: ค่าแรงเช็คระยะ")).toBeVisible();
    await expect(page.getByText(/📝 จะเพิ่มขั้นตอน:.*ตรวจเช็คทั่วไป/)).toBeVisible();

    await page.getByRole("button", { name: "✅ ใช้เซตนี้" }).click();

    await expect
      .poll(async () => {
        const { count } = await adminClient()
          .from("job_cost_items")
          .select("*", { count: "exact", head: true })
          .eq("job_id", testJobId);
        return count;
      }, { timeout: 10_000 })
      .toBe((costCountBefore || 0) + 1);

    await expect
      .poll(async () => {
        const { count } = await adminClient()
          .from("job_workflow_steps")
          .select("*", { count: "exact", head: true })
          .eq("job_id", testJobId);
        return count;
      }, { timeout: 10_000 })
      .toBe((stepCountBefore || 0) + 1);

    // steps ต้องถูก "ต่อท้าย" ของเดิม ไม่ใช่ทับ — เช็คว่าขั้นตอนจาก BUNDLE-002 (ถ้ารันมาก่อน) ยังอยู่ครบ
    const { data: allSteps } = await adminClient().from("job_workflow_steps").select("step_name").eq("job_id", testJobId);
    expect(allSteps.map((s) => s.step_name)).toContain("ตรวจเช็คทั่วไป");
  });
});

test.describe("BUNDLE-004 — ผูกรายการกับอะไหล่ในสต็อกตอนสร้างเซต", () => {
  test("ค้นหาจากสต็อกในรายการ -> เลือก -> auto-fill ชื่อ/รายละเอียด/ราคา + โชว์ \"🔗 ผูกกับสต็อก\" -> save แล้ว part_id ถูกบันทึกจริง", async ({
    page,
  }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const jobTypeName = uniqueName("QA เปลี่ยนอะไหล่จากสต็อก");
    await searchOnJobPage(page, jobTypeName);
    await page.getByRole("button", { name: new RegExp(`\\+ สร้างชุดใหม่ "${jobTypeName}"`) }).click();

    const modal = page.locator(".job-bundle-modal");
    await expect(modal).toBeVisible();

    const stockSearchInput = modal.getByPlaceholder("🔍 ค้นหาจากสต็อก (ไม่บังคับ — เลือกแล้วเติมชื่อ/ราคาให้อัตโนมัติ)");
    // ค้นด้วยส่วนหนึ่งของชื่อ (ชื่อจริงมี timestamp suffix) ให้เจอเฉพาะตัวที่สร้างไว้ใน beforeAll
    const searchTerm = testPartId.part_name.split(" ")[0] + " " + testPartId.part_name.split(" ")[1] + " " + testPartId.part_name.split(" ")[2];
    await stockSearchInput.fill(searchTerm);

    const resultButton = modal.getByRole("button", { name: new RegExp(testPartId.part_name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    await expect(resultButton).toBeVisible({ timeout: 8_000 });
    await resultButton.click();

    await expect(modal.getByPlaceholder("ชื่อรายการ เช่น น้ำมันเกียร์")).toHaveValue(testPartId.part_name);
    await expect(modal.getByPlaceholder("รายละเอียด default")).toHaveValue(testPartId.part_name);
    await expect(modal.getByPlaceholder("ราคา", { exact: true })).toHaveValue("320");
    await expect(modal.getByText(`🔗 ผูกกับสต็อก: ${testPartId.part_name}`)).toBeVisible();

    await modal.getByRole("button", { name: "บันทึกเซตนี้" }).click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    const { data: template } = await adminClient()
      .from("job_type_bundle_templates")
      .select("template_id")
      .eq("shop_id", mainShopId)
      .eq("job_type_name", jobTypeName)
      .single();
    expect(template).toBeTruthy();
    createdTemplateIds.push(template.template_id);

    const { data: item } = await adminClient()
      .from("job_type_bundle_items")
      .select("part_id, item_group_label")
      .eq("template_id", template.template_id)
      .single();
    expect(item.part_id).toBe(testPartId.id);
    expect(item.item_group_label).toBe(testPartId.part_name);
  });
});

test.describe("BUNDLE-005 — Sub-variant ซ่อนแถวราคา default ของรายการหลัก", () => {
  test("มี sub-variant แล้ว -> ซ่อน รายละเอียด default/ปริมาณ/ราคา ของรายการหลัก + โชว์ข้อความแทน", async ({ page }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto(`/jobs/${testJobId}`);
    await expect(page.getByText("📝 ขั้นตอนการทำงาน", { exact: true })).toBeVisible({ timeout: 10_000 });

    const jobTypeName = uniqueName("QA sub-variant hide test");
    await searchOnJobPage(page, jobTypeName);
    await page.getByRole("button", { name: new RegExp(`\\+ สร้างชุดใหม่ "${jobTypeName}"`) }).click();

    const modal = page.locator(".job-bundle-modal");
    await expect(modal).toBeVisible();

    // ก่อนมี sub-variant: เห็นครบทั้ง 3 ช่อง default
    await expect(modal.getByPlaceholder("รายละเอียด default")).toBeVisible();
    await expect(modal.locator('input[placeholder="ปริมาณ"]')).toBeVisible();
    await expect(modal.locator('input[placeholder="ราคา"]')).toBeVisible();
    await expect(modal.getByText(/มี sub-variant แล้ว/)).toHaveCount(0);

    await modal.getByRole("button", { name: "+ เพิ่ม sub-variant" }).click();

    // หลังมี sub-variant: 3 ช่อง default ของรายการหลักต้องหายไป เหลือแค่ของ sub-variant
    await expect(modal.getByPlaceholder("รายละเอียด default")).toHaveCount(0);
    await expect(modal.getByText("มี sub-variant แล้ว (1 ตัว) — ใช้รายละเอียด/ราคาจาก sub-variant ด้านล่างตอนนำไปใช้งานแทน")).toBeVisible();

    await modal.getByRole("button", { name: "ยกเลิก" }).click();
    await expect(modal).toBeHidden();
  });
});

test.describe("BUNDLE-006 — หน้า admin จัดการเซต: แก้ไข/เพิ่ม/ลบ", () => {
  test("หน้า /admin/job-type-bundles: เห็นเซตที่มีอยู่, แก้ราคา sub-variant (onBlur save), เพิ่ม/ลบขั้นตอน", async ({ page }) => {
    const jobTypeName = uniqueName("QA Admin CRUD เซต");
    await createBundleTemplateViaDb({
      jobTypeName,
      items: [
        {
          category: "parts",
          item_group_label: "ยางรถยนต์",
          description: "ยางเดิม",
          default_amount: 1000,
          default_quantity: 4,
          variants: [{ variant_label: "185/65R15", description: "ยาง 185/65R15", default_amount: 1200, default_quantity: 4 }],
        },
      ],
      steps: [],
    });

    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto("/admin/job-type-bundles");
    await expect(page.getByRole("heading", { name: /เซตอะไหล่\+ค่าแรงตามประเภทงาน/ })).toBeVisible({ timeout: 10_000 });

    const row = page.locator(".card", { hasText: jobTypeName });
    await expect(row).toBeVisible({ timeout: 8_000 });
    await row.getByRole("button", { name: new RegExp(jobTypeName) }).click();

    // แก้ไขราคา sub-variant ผ่าน input title="ราคา" (onBlur save — ดู handleUpdateVariantField)
    const priceInput = row.locator('input[title="ราคา"]').first();
    await expect(priceInput).toHaveValue("1200");
    await priceInput.fill("1350");
    await priceInput.blur();

    await expect
      .poll(async () => {
        const { data } = await adminClient()
          .from("job_type_bundle_item_variants")
          .select("default_amount")
          .eq("variant_label", "185/65R15")
          .single();
        return Number(data?.default_amount);
      }, { timeout: 8_000 })
      .toBe(1350);

    // เพิ่มขั้นตอนใหม่ผ่าน "+ เพิ่มขั้นตอน" (ยังไม่มอบหมายเลย ไม่มีช่องให้เลือกคนรับผิดชอบในหน้านี้เลย)
    const stepInputsLocator = row.locator('input[placeholder="ชื่อขั้นตอน"]');
    await expect(stepInputsLocator).toHaveCount(0);
    await row.getByRole("button", { name: "+ เพิ่มขั้นตอน" }).click();
    await expect(stepInputsLocator).toHaveCount(1, { timeout: 8_000 });
    await expect(stepInputsLocator.first()).toHaveValue("ขั้นตอนใหม่");

    // ลบขั้นตอนที่เพิ่งเพิ่มผ่านปุ่ม "✕" ข้างๆ (scope ไปที่ div ที่ห่อ step input โดยตรง กัน
    // ไปชนปุ่ม "✕" ของรายการ/sub-variant อื่นในการ์ดเดียวกัน)
    const stepRow = stepInputsLocator.first().locator("xpath=..");
    await stepRow.getByRole("button", { name: "✕" }).click();
    await expect(stepInputsLocator).toHaveCount(0, { timeout: 8_000 });

    const { data: template } = await adminClient()
      .from("job_type_bundle_templates")
      .select("template_id")
      .eq("shop_id", mainShopId)
      .eq("job_type_name", jobTypeName)
      .single();
    const { data: remainingSteps } = await adminClient()
      .from("job_type_bundle_steps")
      .select("step_id")
      .eq("template_id", template.template_id);
    expect(remainingSteps).toHaveLength(0);
  });
});

test.describe("BUNDLE-007 — RBAC: หน้า /admin/job-type-bundles", () => {
  test("Technician เข้า /admin/job-type-bundles ต้องเจอ role-forbidden (ไม่ใช่ owner/manager/admin)", async ({ page }) => {
    await loginWithStaffPin(page, accounts.technician.username, accounts.technician.pin);
    await expectLoginSucceeded(page);
    await page.goto("/admin/job-type-bundles");
    await expectRoleForbidden(page, "technician");
  });

  test("Sanity: Owner เข้า /admin/job-type-bundles ได้ปกติ ไม่เจอ role-forbidden", async ({ page }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await page.goto("/admin/job-type-bundles");
    await expect(page.locator(".msg.error", { hasText: "ไม่มีสิทธิ์เข้าหน้านี้" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /เซตอะไหล่\+ค่าแรงตามประเภทงาน/ })).toBeVisible({ timeout: 8_000 });
  });
});
