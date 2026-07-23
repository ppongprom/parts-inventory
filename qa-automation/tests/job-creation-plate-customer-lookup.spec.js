import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded } from "../fixtures/auth-helpers.js";
import { expectJobSavedSuccessfully } from "../fixtures/job-helpers.js";
import { adminClient, getShopIdByName } from "../fixtures/db-client.js";
import { accounts } from "../fixtures/test-data.js";

// ------------------------------------------------------------
// Coverage สำหรับหน้า /jobs/new เวอร์ชันใหม่ (redesign session นี้) — โฟกัสเฉพาะ
// พฤติกรรม lookup/autofill ใหม่ ที่ job-creation-basic.spec.js (ฟอร์มแบบเดิม) ยังไม่คลุม:
//   - ค้นทะเบียนรถจากงานเก่า -> autofill ลูกค้า+รถ (searchPlateHistory/selectPlateHistory)
//   - ค้นชื่อลูกค้าจากตาราง customers -> autofill เบอร์/ที่อยู่ โดยไม่แตะทะเบียนที่พิมพ์ไว้
//     (searchCustomers/selectCustomer)
//   - ลำดับ field ใหม่: ทะเบียนรถ -> ค้นหารถ (CarAutocomplete) -> ชื่อลูกค้า -> เบอร์ -> ที่อยู่
//   - guard กันผลลัพธ์ query เก่ามาทับผลของ query ใหม่ (plateSearchIdRef/customerSearchIdRef)
//
// อ้างอิง source ตรงจาก app/jobs/new/page.js (อ่านทั้งไฟล์ก่อนเขียนเทสต์นี้) — ถ้า markup/state
// เปลี่ยน ให้แก้ selector ที่นี่ตามจริง
// ------------------------------------------------------------

let mainShopId;
const createdJobIds = []; // งานที่ seed ตรงผ่าน adminClient() หรือสร้างผ่าน UI ระหว่างเทสต์
const createdCustomerIds = []; // แถว customers ที่ seed ตรงผ่าน adminClient()

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** locator ของกล่อง dropdown ผลลัพธ์ที่ scope อยู่ใน <label> ของ "ทะเบียนรถ" เท่านั้น
 *  กันชนกับปุ่ม 🚗 ของ CarDamageDiagram (type-toggle) ที่อยู่คนละ label ไปเลย */
function plateDropdownButtons(page) {
  return page.locator("label", { hasText: "ทะเบียนรถ" }).locator("button");
}

/** locator ของกล่อง dropdown ผลลัพธ์ของ "ชื่อลูกค้า" */
function customerDropdownButtons(page) {
  return page.locator("label", { hasText: "ชื่อลูกค้า" }).locator("button");
}

async function seedJob(overrides = {}) {
  const { data, error } = await adminClient()
    .from("jobs")
    .insert({
      shop_id: mainShopId,
      status: "received",
      ...overrides,
    })
    .select("job_id")
    .single();
  if (error) throw new Error(`seedJob ล้มเหลว: ${error.message}`);
  createdJobIds.push(data.job_id);
  return data.job_id;
}

async function seedCustomer(overrides = {}) {
  const { data, error } = await adminClient()
    .from("customers")
    .insert({
      shop_id: mainShopId,
      ...overrides,
    })
    .select("customer_id")
    .single();
  if (error) throw new Error(`seedCustomer ล้มเหลว: ${error.message}`);
  createdCustomerIds.push(data.customer_id);
  return data.customer_id;
}

test.beforeAll(async () => {
  mainShopId = await getShopIdByName("QA Test Shop (auto)");
});

test.afterAll(async () => {
  for (const id of createdJobIds) {
    await adminClient().from("jobs").delete().eq("job_id", id);
  }
  for (const id of createdCustomerIds) {
    await adminClient().from("customers").delete().eq("customer_id", id);
  }
});

test.beforeEach(async ({ page }) => {
  await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
  await expectLoginSucceeded(page);
});

test.describe("LOOKUP-001 — Field order ของฟอร์มใหม่", () => {
  test('label "ทะเบียนรถ" ต้องอยู่ก่อน "ชื่อลูกค้า" ใน DOM', async ({ page }) => {
    await page.goto("/jobs/new");
    // รอให้ฟอร์ม hydrate/render เสร็จก่อน — ทะเบียนรถเป็น input แรกในฟอร์ม ใช้เป็นสัญญาณว่าพร้อมแล้ว
    await page.getByLabel("ทะเบียนรถ").waitFor({ state: "visible", timeout: 10_000 });
    const labelTexts = await page.locator("form label").allTextContents();

    const plateIndex = labelTexts.findIndex((t) => t.includes("ทะเบียนรถ"));
    const customerIndex = labelTexts.findIndex((t) => t.includes("ชื่อลูกค้า"));

    expect(plateIndex).toBeGreaterThanOrEqual(0);
    expect(customerIndex).toBeGreaterThanOrEqual(0);
    expect(plateIndex).toBeLessThan(customerIndex);
  });
});

test.describe("LOOKUP-002 — ค้นทะเบียนรถเจอ -> autofill ลูกค้า+รถทั้งหมด", () => {
  test("พิมพ์บางส่วนของทะเบียนที่เคยมีงานเก่า -> เลือกผลลัพธ์ -> ทุกช่องถูกเติมค่าให้ถูกต้อง รวมทั้งบรรทัดยืนยันรถ", async ({
    page,
  }) => {
    const suffix = Date.now();
    const plate = `กข-${suffix} กรุงเทพฯ`;
    const platePartial = `${suffix}`; // substring เฉพาะส่วนตัวเลขที่ไม่ชนกับข้อมูลอื่นในระบบ
    const customerName = `QA Plate Match Customer ${suffix}`;
    const customerPhone = `08${suffix}`.slice(0, 10);
    const customerAddress = `999 ถ.ทดสอบทะเบียน ${suffix}`;
    const carBrand = "Toyota";
    const carModel = "Camry";

    await seedJob({
      license_plate: plate,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      car_brand: carBrand,
      car_model: carModel,
      car_year_display: null,
      generation_id: null,
      trim_id: null,
    });

    await page.goto("/jobs/new");
    await page.getByLabel("ทะเบียนรถ").fill(platePartial);

    const resultButton = plateDropdownButtons(page).filter({
      hasText: new RegExp(
        `${escapeRegExp(plate)}.*${escapeRegExp(customerName)}.*${escapeRegExp(carBrand)}.*${escapeRegExp(carModel)}`
      ),
    });
    await expect(resultButton).toBeVisible({ timeout: 8000 });
    await resultButton.click();

    await expect(page.getByLabel("ทะเบียนรถ")).toHaveValue(plate);
    await expect(page.getByLabel("ชื่อลูกค้า")).toHaveValue(customerName);
    await expect(page.getByLabel("เบอร์โทรลูกค้า")).toHaveValue(customerPhone);
    await expect(page.getByLabel(/ที่อยู่ลูกค้า/)).toHaveValue(customerAddress);

    // บรรทัดยืนยันรถ "🚗 {brand} {model}" ต้องโผล่ แม้ CarAutocomplete จะไม่ได้ถูกพิมพ์ใน UI เลย
    // (พิสูจน์ workaround: CarAutocomplete เป็น uncontrolled input เก็บ query เอง)
    await expect(
      page.getByText(new RegExp(`🚗 ${escapeRegExp(carBrand)} ${escapeRegExp(carModel)}`))
    ).toBeVisible();

    // dropdown ต้องปิดหลังเลือกแล้ว
    await expect(plateDropdownButtons(page)).toHaveCount(0);
  });
});

test.describe("LOOKUP-003 — ทะเบียนซ้ำหลายงาน: dedupe และเอางานล่าสุดชนะ", () => {
  test("ทะเบียนเดียวกัน 2 งาน (ต่างลูกค้า) -> โชว์ผลลัพธ์เดียว (deduped) และเลือกแล้วได้ข้อมูลของงานล่าสุด", async ({
    page,
  }) => {
    const suffix = Date.now();
    const plate = `ญญ-${suffix} เชียงใหม่`;
    const platePartial = `${suffix}`;
    const olderCustomerName = `QA Older Owner ${suffix}`;
    const newerCustomerName = `QA Newer Owner ${suffix}`;

    const olderCreatedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // -2h
    const newerCreatedAt = new Date(Date.now() - 1 * 60 * 1000).toISOString(); // -1min

    await seedJob({
      license_plate: plate,
      customer_name: olderCustomerName,
      created_at: olderCreatedAt,
    });
    await seedJob({
      license_plate: plate,
      customer_name: newerCustomerName,
      created_at: newerCreatedAt,
    });

    await page.goto("/jobs/new");
    await page.getByLabel("ทะเบียนรถ").fill(platePartial);

    const allResultsForPlate = plateDropdownButtons(page).filter({
      hasText: new RegExp(escapeRegExp(plate)),
    });
    await expect(allResultsForPlate).toHaveCount(1, { timeout: 8000 });
    await expect(allResultsForPlate).toContainText(newerCustomerName);
    await expect(allResultsForPlate).not.toContainText(olderCustomerName);

    await allResultsForPlate.click();
    await expect(page.getByLabel("ชื่อลูกค้า")).toHaveValue(newerCustomerName);
  });
});

test.describe("LOOKUP-004 — ทะเบียนที่ไม่เคยมีในระบบ: ไม่มี dropdown / ไม่ false-positive", () => {
  test("พิมพ์ทะเบียนสุ่มใหม่เอี่ยม -> ไม่มีผลลัพธ์โผล่ในกล่อง dropdown ของทะเบียนเลย", async ({ page }) => {
    await page.goto("/jobs/new");
    const freshPlate = `NOPLATE-${Date.now()}`;

    await page.getByLabel("ทะเบียนรถ").fill(freshPlate);
    // รอให้ query (ถ้ามี) มีเวลายิงตอบกลับ ก่อนเช็คว่าไม่มีผลลัพธ์
    await page.waitForTimeout(1000);

    // สำคัญ: ต้อง scope เฉพาะ dropdown ของช่องทะเบียน ไม่ใช่หา 🚗 ทั้งหน้า เพราะปุ่ม
    // toggle ประเภทรถใน CarDamageDiagram ก็ใช้ emoji 🚗 เป็นข้อความปุ่มเหมือนกัน (false positive)
    await expect(plateDropdownButtons(page)).toHaveCount(0);
  });
});

test.describe("LOOKUP-005 — ค้นชื่อลูกค้าเก่า + ทะเบียนใหม่ (ลูกค้าเดิม รถคันใหม่)", () => {
  test("ทะเบียนที่พิมพ์ไว้ต้องไม่ถูกแตะ เมื่อเลือกลูกค้าเก่าจาก dropdown ชื่อลูกค้า", async ({ page }) => {
    const suffix = Date.now();
    const customerName = `QA Existing Customer ${suffix}`;
    const customerNamePartial = `${suffix}`;
    const customerPhone = `09${suffix}`.slice(0, 10);
    const customerAddress = `456 ถ.ลูกค้าเดิม ${suffix}`;
    const freshPlate = `NEWCAR-${suffix}`;

    await seedCustomer({
      name: customerName,
      phone: customerPhone,
      address: customerAddress,
    });

    await page.goto("/jobs/new");

    // พิมพ์ทะเบียนใหม่ (ไม่ตรงกับงานเก่าใดๆ) ก่อน -> ต้องไม่มี autofill จากทะเบียน
    await page.getByLabel("ทะเบียนรถ").fill(freshPlate);
    await page.waitForTimeout(500);
    await expect(plateDropdownButtons(page)).toHaveCount(0);

    // ค้นชื่อลูกค้าเก่า
    await page.getByLabel("ชื่อลูกค้า").fill(customerNamePartial);
    const customerResult = customerDropdownButtons(page).filter({
      hasText: new RegExp(`👤.*${escapeRegExp(customerName)}`),
    });
    await expect(customerResult).toBeVisible({ timeout: 8000 });
    await customerResult.click();

    await expect(page.getByLabel("เบอร์โทรลูกค้า")).toHaveValue(customerPhone);
    await expect(page.getByLabel(/ที่อยู่ลูกค้า/)).toHaveValue(customerAddress);

    // core assertion: ทะเบียนที่พิมพ์ไว้ก่อนหน้าต้องยังอยู่ครบ ไม่ถูกล้าง/ทับ
    await expect(page.getByLabel("ทะเบียนรถ")).toHaveValue(freshPlate);

    await expect(customerDropdownButtons(page)).toHaveCount(0);
  });
});

test.describe("LOOKUP-006 — Race-condition guard: query เก่าต้องไม่มาทับผลของ query ใหม่กว่า", () => {
  test("พิมพ์ทะเบียนที่มีผลลัพธ์แล้วรีบล้างช่องว่างทันที -> ต้องไม่เหลือ dropdown ค้างจาก query เก่า", async ({
    page,
  }) => {
    // ใช้ทะเบียนจากสถานการณ์ LOOKUP-002 (seed ไว้แล้วและยังไม่ถูกลบจนกว่า afterAll) เป็น query
    // ที่การันตีว่ามีผลลัพธ์แน่ๆ ถ้า guard ทำงานพลาด ผลลัพธ์เก่าจะโผล่ค้างหลังเคลียร์ช่อง
    const suffix = Date.now();
    const raceQueryPlate = `RACE-${suffix}`;
    await seedJob({
      license_plate: raceQueryPlate,
      customer_name: `QA Race Guard Customer ${suffix}`,
    });

    await page.goto("/jobs/new");
    const plateInput = page.getByLabel("ทะเบียนรถ");

    // ยิง query ที่มีผลลัพธ์ แล้วรีบล้างช่องทันทีโดยไม่รอ response ของ query แรกกลับมาก่อน
    await plateInput.fill(raceQueryPlate);
    await plateInput.fill("");

    // ให้เวลา response ของ query แรก (ถ้ามาช้ากว่า) มีโอกาสกลับมาเต็มที่ก่อนเช็คผล
    await page.waitForTimeout(1500);

    await expect(plateInput).toHaveValue("");
    await expect(plateDropdownButtons(page)).toHaveCount(0);
  });
});

test.describe("LOOKUP-007 — Submit end-to-end หลังใช้ lookup autofill", () => {
  test("เลือกผลลัพธ์จากทะเบียน แล้วกดบันทึกงาน -> สร้างงานสำเร็จและ redirect ไปหน้า /jobs/:id", async ({
    page,
  }) => {
    const suffix = Date.now();
    const plate = `SUBMIT-${suffix}`;
    const customerName = `QA Submit Flow Customer ${suffix}`;
    const customerPhone = `06${suffix}`.slice(0, 10);
    const customerAddress = `789 ถ.ทดสอบ submit ${suffix}`;
    const carBrand = "Honda";
    const carModel = "Civic";

    await seedJob({
      license_plate: plate,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_address: customerAddress,
      car_brand: carBrand,
      car_model: carModel,
    });

    await page.goto("/jobs/new");
    await page.getByLabel("ทะเบียนรถ").fill(plate);

    const resultButton = plateDropdownButtons(page).filter({
      hasText: new RegExp(escapeRegExp(plate)),
    });
    await expect(resultButton).toBeVisible({ timeout: 8000 });
    await resultButton.click();

    await expect(page.getByLabel("ชื่อลูกค้า")).toHaveValue(customerName);

    await page.getByRole("button", { name: /รับงานเข้าอู่/ }).click();
    const jobId = await expectJobSavedSuccessfully(page);
    expect(jobId).toBeTruthy();
    createdJobIds.push(jobId);

    const { data: job } = await adminClient()
      .from("jobs")
      .select("customer_name, customer_phone, customer_address, car_brand, car_model, license_plate")
      .eq("job_id", jobId)
      .single();
    expect(job.license_plate).toBe(plate);
    expect(job.customer_name).toBe(customerName);
    expect(job.customer_phone).toBe(customerPhone);
    expect(job.customer_address).toBe(customerAddress);
    expect(job.car_brand).toBe(carBrand);
    expect(job.car_model).toBe(carModel);
  });
});
