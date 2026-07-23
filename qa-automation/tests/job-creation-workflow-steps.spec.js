import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import {
  fillBasicJobForm,
  addWorkflowStep,
  submitJobForm,
  expectJobSavedSuccessfully,
  expectJobSaveFailed,
} from "../fixtures/job-helpers.js";
import { adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { accounts } from "../fixtures/test-data.js";

let mainShopId;
const createdJobIds = [];

test.beforeAll(async () => {
  mainShopId = await getShopIdByName("QA Test Shop (auto)");
});

test.afterAll(async () => {
  for (const id of createdJobIds) {
    await adminClient().from("job_workflow_steps").delete().eq("job_id", id);
    await adminClient().from("jobs").delete().eq("job_id", id);
  }
});

test.beforeEach(async ({ page }) => {
  await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
  await expectLoginSucceeded(page);
});

test("JOB-301 เพิ่ม/ลบแถวขั้นตอนงานแบบ dynamic — เฉพาะแถวที่มีชื่อไม่ว่างเท่านั้นถูกบันทึก", async ({
  page,
}) => {
  const marker = `QA-JOB-301-${Date.now()}`;
  await fillBasicJobForm(page, { customerName: marker });

  await addWorkflowStep(page, 0, "รื้อตรวจสภาพ");
  await addWorkflowStep(page, 1, ""); // เว้นว่างตั้งใจ — ต้องถูกกรองทิ้ง
  await addWorkflowStep(page, 2, "เคาะสี");
  await addWorkflowStep(page, 3, "ตรวจสอบก่อนส่งมอบ");

  // ลบแถวที่ 2 (index 1, ที่เว้นว่างไว้) ออกก่อน submit — หา container div ของ input แถวนั้น
  // ด้วย xpath=".." (bare ".." ไม่ใช่ CSS selector ที่ถูกต้อง ต้องระบุ xpath= ชัดเจน)
  const step2Row = page.locator('input[placeholder="เช่น รื้อตรวจสภาพ"]').nth(1).locator("xpath=..");
  await step2Row.getByRole("button", { name: "×" }).click();

  await submitJobForm(page);
  const jobId = await expectJobSavedSuccessfully(page);
  createdJobIds.push(jobId);

  const { data: steps } = await adminClient()
    .from("job_workflow_steps")
    .select("step_name, step_order")
    .eq("job_id", jobId)
    .order("step_order");

  // ควรเหลือ 3 ขั้นตอนที่มีชื่อจริง (แถวว่างที่ลบไปแล้วไม่นับ, กันเผื่อ UI ลบไม่ตรงแถวก็ต้องไม่มีชื่อว่างหลุดมา)
  expect(steps.every((s) => s.step_name.trim().length > 0)).toBe(true);
  expect(steps.map((s) => s.step_name)).toEqual(
    expect.arrayContaining(["รื้อตรวจสภาพ", "เคาะสี", "ตรวจสอบก่อนส่งมอบ"])
  );
});

test("JOB-303 (แก้แล้ว 23 ก.ค. 2569) RPC ทั้งก้อน abort กลางทาง -> ไม่มี jobs row leak เลย (atomic กับ workflow steps ด้วย)", async ({
  page,
}) => {
  // เดิม job_workflow_steps insert เป็นคนละ request จาก jobs insert (fail แล้ว job ยังอยู่แต่ไม่มี step)
  // ตอนนี้อยู่ใน create_job_atomic RPC เดียวกันหมดแล้ว (db/atomic_job_creation_migration.sql)
  const marker = `QA-JOB-303-${Date.now()}`;

  await page.route("**/rest/v1/rpc/create_job_atomic*", (route) => route.abort("failed"));

  await fillBasicJobForm(page, { customerName: marker });
  await addWorkflowStep(page, 0, "ขั้นตอนที่ควรจะหายไป");
  await submitJobForm(page);
  await expectJobSaveFailed(page);

  const { data: leakedJob } = await adminClient()
    .from("jobs")
    .select("job_id")
    .eq("shop_id", mainShopId)
    .eq("customer_name", marker)
    .maybeSingle();
  expect(leakedJob, "✅ ไม่ควรมี jobs row ถูกสร้างเลยเมื่อ request ทั้งก้อนล้มเหลว (rollback ครบทั้ง job+steps)").toBeNull();
});
