import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import {
  fillBasicJobForm,
  toggleVisibilityGroup,
  submitJobForm,
  expectJobSavedSuccessfully,
  expectJobSaveFailed,
} from "../fixtures/job-helpers.js";
import { adminClient, getShopIdByName, signInEmail, signInStaff } from "../fixtures/db-client.js";
import { accounts } from "../fixtures/test-data.js";

let mainShopId;
let groupAId; // "QA Test Group A" — seeded โดย setup-test-data.mjs, มี supervisor เป็นสมาชิก
let groupBId; // สร้างเฉพาะไฟล์นี้ สำหรับเทสต์ multi-group (JOB-205)
const createdJobIds = [];

test.beforeAll(async () => {
  mainShopId = await getShopIdByName("QA Test Shop (auto)");

  const { data: groupA, error: groupAErr } = await adminClient()
    .from("visibility_groups")
    .select("group_id")
    .eq("shop_id", mainShopId)
    .eq("name", "QA Test Group A")
    .single();
  if (groupAErr) {
    throw new Error(
      `ไม่พบ "QA Test Group A" — รัน npm run setup:data ให้เสร็จก่อน หรือดู job-00-schema-preflight.spec.js ว่าผ่านหรือยัง: ${groupAErr.message}`
    );
  }
  groupAId = groupA.group_id;

  const { data: groupB, error: groupBErr } = await adminClient()
    .from("visibility_groups")
    .insert({ shop_id: mainShopId, name: "QA Test Group B (multi-group test)" })
    .select("group_id")
    .single();
  if (groupBErr) throw groupBErr;
  groupBId = groupB.group_id;
  // ใส่ assistant เป็นสมาชิกกลุ่ม B (ต่างจากกลุ่ม A ที่มี supervisor) เพื่อทดสอบ OR logic ใน JOB-205
  const { data: assistantMember } = await adminClient()
    .from("shop_members")
    .select("user_id")
    .eq("shop_id", mainShopId)
    .eq("login_username", accounts.assistant.username)
    .single();
  await adminClient()
    .from("visibility_group_members")
    .upsert({ group_id: groupBId, user_id: assistantMember.user_id }, { onConflict: "group_id,user_id" });
});

test.afterAll(async () => {
  for (const id of createdJobIds) {
    await adminClient().from("job_visibility_groups").delete().eq("job_id", id);
    await adminClient().from("jobs").delete().eq("job_id", id);
  }
  if (groupBId) await adminClient().from("visibility_groups").delete().eq("group_id", groupBId);
});

test.beforeEach(async ({ page }) => {
  await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
  await expectLoginSucceeded(page);
});

test("JOB-201 เลือก visibility group แล้วสร้างงานสำเร็จ -> เฉพาะสมาชิกกลุ่มนั้น (+owner/manager) เห็นงานนี้", async ({
  page,
}) => {
  const marker = `QA-JOB-201-${Date.now()}`;
  await fillBasicJobForm(page, { customerName: marker });
  await toggleVisibilityGroup(page, "QA Test Group A");
  await submitJobForm(page);
  const jobId = await expectJobSavedSuccessfully(page);
  createdJobIds.push(jobId);

  const { data: linkRows } = await adminClient()
    .from("job_visibility_groups")
    .select("group_id")
    .eq("job_id", jobId);
  expect(linkRows).toEqual([{ group_id: groupAId }]);

  // supervisor (สมาชิกกลุ่ม A) ต้องเห็นงานนี้ผ่าน RLS
  const { client: supervisorClient } = await signInStaff(
    accounts.supervisor.username,
    accounts.supervisor.pin
  );
  const { data: seenBySupervisor } = await supervisorClient
    .from("jobs")
    .select("job_id")
    .eq("job_id", jobId);
  expect(seenBySupervisor).toHaveLength(1);

  // technician (ไม่ใช่สมาชิกกลุ่มไหนเลย) ต้อง "ไม่เห็น" งานนี้
  const { client: technicianClient } = await signInStaff(
    accounts.technician.username,
    accounts.technician.pin
  );
  const { data: seenByTechnician } = await technicianClient
    .from("jobs")
    .select("job_id")
    .eq("job_id", jobId);
  expect(seenByTechnician).toEqual([]);

  // manager ต้องเห็นเสมอไม่ว่าจะอยู่กลุ่มไหน (can_view_job: is_shop_member(...['owner','manager']))
  const { client: managerClient } = await signInEmail(accounts.manager.email, accounts.manager.password);
  const { data: seenByManager } = await managerClient.from("jobs").select("job_id").eq("job_id", jobId);
  expect(seenByManager).toHaveLength(1);
});

test("JOB-204 ไม่เลือก visibility group เลย -> ทุกคนในอู่เห็นงานนี้ได้ (ค่า default ที่ตั้งใจ)", async ({
  page,
}) => {
  const marker = `QA-JOB-204-${Date.now()}`;
  await fillBasicJobForm(page, { customerName: marker });
  await submitJobForm(page);
  const jobId = await expectJobSavedSuccessfully(page);
  createdJobIds.push(jobId);

  const { data: linkRows } = await adminClient()
    .from("job_visibility_groups")
    .select("group_id")
    .eq("job_id", jobId);
  expect(linkRows).toEqual([]);

  const { client: technicianClient } = await signInStaff(
    accounts.technician.username,
    accounts.technician.pin
  );
  const { data: seenByTechnician } = await technicianClient
    .from("jobs")
    .select("job_id")
    .eq("job_id", jobId);
  expect(seenByTechnician).toHaveLength(1); // เห็นได้ เพราะไม่มีกลุ่มผูกไว้เลย
});

test("JOB-205 เลือก 2 กลุ่มพร้อมกัน -> สมาชิกกลุ่มใดกลุ่มหนึ่ง (OR logic) เห็นงานได้ทั้งคู่", async ({
  page,
}) => {
  const marker = `QA-JOB-205-${Date.now()}`;
  await fillBasicJobForm(page, { customerName: marker });
  await toggleVisibilityGroup(page, "QA Test Group A"); // สมาชิก: supervisor
  await toggleVisibilityGroup(page, "QA Test Group B"); // สมาชิก: assistant
  await submitJobForm(page);
  const jobId = await expectJobSavedSuccessfully(page);
  createdJobIds.push(jobId);

  const { data: linkRows } = await adminClient()
    .from("job_visibility_groups")
    .select("group_id")
    .eq("job_id", jobId);
  expect(linkRows).toHaveLength(2);

  for (const [label, username, pin] of [
    ["supervisor (กลุ่ม A)", accounts.supervisor.username, accounts.supervisor.pin],
    ["assistant (กลุ่ม B)", accounts.assistant.username, accounts.assistant.pin],
  ]) {
    const { client } = await signInStaff(username, pin);
    const { data } = await client.from("jobs").select("job_id").eq("job_id", jobId);
    expect(data, `${label} ควรเห็นงานนี้ได้`).toHaveLength(1);
  }

  // technician ไม่ได้อยู่กลุ่มไหนเลยในสองกลุ่มนี้ -> ไม่เห็น
  const { client: technicianClient } = await signInStaff(
    accounts.technician.username,
    accounts.technician.pin
  );
  const { data: seenByTechnician } = await technicianClient
    .from("jobs")
    .select("job_id")
    .eq("job_id", jobId);
  expect(seenByTechnician).toEqual([]);
});

test.describe("✅ JOB-202/203 (แก้แล้ว 23 ก.ค. 2569) — create_job_atomic RPC ต้อง atomic จริง ไม่ leak/ไม่ duplicate", () => {
  // เดิม (จนถึง 22 ก.ค. 2569) app/jobs/new/page.js insert jobs -> job_visibility_groups
  // -> job_workflow_steps แยก 3 คำสั่งอิสระ ทำให้ jobs insert สำเร็จได้ทั้งที่คำสั่งถัดไป fail
  // (ดู git history ของไฟล์นี้สำหรับ test เดิมที่ pin บั๊กไว้) ตอนนี้ทั้งหมดถูกครอบเป็น RPC เดียว
  // (db/atomic_job_creation_migration.sql: create_job_atomic, SECURITY INVOKER) — ทดสอบ 2 ระดับ:
  // ระดับ DB ตรงๆ (พิสูจน์ atomicity จริงของฟังก์ชัน ไม่ผูกกับ UI/network mocking) และระดับ E2E
  // ผ่านฟอร์มจริง (พิสูจน์ว่า route เดียวจริง ไม่มีการยิงหลาย request ที่ mock แยกกันได้อีกต่อไป)

  test("JOB-202a [DB-level] group_id ไม่มีอยู่จริง (FK violation) ระหว่าง RPC -> ทั้งฟังก์ชัน rollback ไม่เหลือ jobs row เลย", async () => {
    const marker = `QA-JOB-202a-${Date.now()}`;
    const bogusGroupId = 999999999; // ไม่มีอยู่จริงแน่นอน -> job_visibility_groups insert จะ FK violation

    const { error } = await adminClient().rpc("create_job_atomic", {
      p_shop_id: mainShopId,
      p_customer_id: null,
      p_customer_name: marker,
      p_customer_phone: null,
      p_customer_address: null,
      p_car_brand: null,
      p_car_model: null,
      p_car_year_display: null,
      p_generation_id: null,
      p_trim_id: null,
      p_license_plate: null,
      p_source_type: null,
      p_notes: null,
      p_photo_urls: [],
      p_damage_points: [],
      p_car_diagram_type: "sedan",
      p_created_by: null,
      p_group_ids: [bogusGroupId],
      p_workflow_steps: [],
    });
    expect(error, "ควร error เพราะ group_id ไม่มีอยู่จริง (FK violation)").toBeTruthy();

    // ✅ ต้องไม่มี jobs row หลงเหลือเลยแม้แต่แถวเดียว (ต่างจากพฤติกรรมเดิมที่ jobs insert
    // ผ่านไปแล้วก่อนจะไป fail ที่ job_visibility_groups)
    const { data: leftoverJobs } = await adminClient()
      .from("jobs")
      .select("job_id")
      .eq("shop_id", mainShopId)
      .eq("customer_name", marker);
    expect(leftoverJobs, "✅ ต้อง rollback หมด ไม่เหลือ jobs row ค้างจาก transaction ที่ fail").toEqual([]);
  });

  test("JOB-202b [E2E] RPC request ทั้งก้อนถูก abort (จำลอง network fail) -> ไม่มี jobs row leak ผ่านฟอร์มจริง", async ({
    page,
  }) => {
    const marker = `QA-JOB-202b-${Date.now()}`;

    // ตอนนี้ jobs+groups+steps ยิงเป็น request เดียว (rpc/create_job_atomic) แล้ว
    // ไม่ใช่ 3 request แยกเหมือนเดิม จึง abort ที่ endpoint เดียวนี้ก็ครอบคลุมทั้งก้อน
    await page.route("**/rest/v1/rpc/create_job_atomic*", (route) => route.abort("failed"));

    await fillBasicJobForm(page, { customerName: marker });
    await toggleVisibilityGroup(page, "QA Test Group A");
    await submitJobForm(page);
    await expectJobSaveFailed(page);

    const { data: leakedJob } = await adminClient()
      .from("jobs")
      .select("job_id")
      .eq("shop_id", mainShopId)
      .eq("customer_name", marker)
      .maybeSingle();
    expect(leakedJob, "✅ ไม่ควรมี jobs row ถูกสร้างเลยเมื่อ request ทั้งก้อนล้มเหลว").toBeNull();
  });

  test("JOB-203 (แก้แล้ว) กด submit ซ้ำหลัง error จริง -> ได้ job แค่ 1 ใบ ไม่ใช่ 2 ใบซ้ำกัน", async ({
    page,
  }) => {
    const marker = `QA-JOB-203-${Date.now()}`;

    await page.route("**/rest/v1/rpc/create_job_atomic*", (route) => route.abort("failed"));
    await fillBasicJobForm(page, { customerName: marker });
    await toggleVisibilityGroup(page, "QA Test Group A");
    await submitJobForm(page);
    await expectJobSaveFailed(page);

    // เอา intercept ออก แล้วกด submit ซ้ำ (เหมือนผู้ใช้จริงที่เห็น error แล้วลองใหม่)
    await page.unroute("**/rest/v1/rpc/create_job_atomic*");
    await submitJobForm(page);
    const jobId = await expectJobSavedSuccessfully(page);
    createdJobIds.push(jobId);

    const { data: allJobsForMarker } = await adminClient()
      .from("jobs")
      .select("job_id")
      .eq("shop_id", mainShopId)
      .eq("customer_name", marker);

    createdJobIds.push(...allJobsForMarker.map((j) => j.job_id));
    expect(
      allJobsForMarker.length,
      "✅ ควรมี job แค่ 1 ใบ — ครั้งแรกล้มเหลวไม่ได้สร้างอะไรค้างไว้เลย (ต่างจากพฤติกรรมเดิม)"
    ).toBe(1);
  });
});
