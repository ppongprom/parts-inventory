// Card: "ลบ dead code: CarCascadeSelect.js, TrimSelect.js"
// ประเภทงาน: cleanup — ลบ 2 ไฟล์ที่ไม่มีหน้าไหนเรียกใช้แล้ว
//
// NOTE ด้าน environment: sandbox นี้เข้าถึง *.supabase.co ตรงๆ ไม่ได้ (proxy ปฏิเสธ)
// จึง mock เครือข่าย Supabase ทั้งหมด (auth + REST) ผ่าน qa-tests/_fixtures/mockAuth.js
// โดยใช้ข้อมูลจริงจาก car_search_display บน staging (BYD Atto 3, 4 trims) เพื่อให้ยัง
// ทดสอบ regression ของ CarAutocomplete ได้จริงตามที่การ์ดกำหนด ("byd atto" ต้องเจอ)
// แม้จะจำลอง transport layer ก็ตาม
const { test, expect } = require('@playwright/test');
const { installMockAuth } = require('./_fixtures/mockAuth');

const BYD_ATTO_ROWS = [
  { generation_id: 20, trim_id: 24, brand_name: 'BYD', model_name: 'Atto 3', generation_code: '2022-ปัจจุบัน', year_range_display: '2022 - ปัจจุบัน', vehicle_type: null, trim_name: 'ไม่ระบุ', powertrain_type: null },
  { generation_id: 20, trim_id: 1507, brand_name: 'BYD', model_name: 'Atto 3', generation_code: '2022-ปัจจุบัน', year_range_display: '2022 - ปัจจุบัน', vehicle_type: null, trim_name: 'Premium', powertrain_type: 'EV' },
  { generation_id: 20, trim_id: 1508, brand_name: 'BYD', model_name: 'Atto 3', generation_code: '2022-ปัจจุบัน', year_range_display: '2022 - ปัจจุบัน', vehicle_type: null, trim_name: 'Dynamic', powertrain_type: 'EV' },
  { generation_id: 20, trim_id: 1509, brand_name: 'BYD', model_name: 'Atto 3', generation_code: '2022-ปัจจุบัน', year_range_display: '2022 - ปัจจุบัน', vehicle_type: null, trim_name: 'Extended', powertrain_type: 'EV' },
];

test('/add boots for a logged-in user with no crash, and CarAutocomplete ("byd atto") still finds results after removing CarCascadeSelect.js/TrimSelect.js', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await installMockAuth(page, {
    extraRoutes: async (route, url) => {
      if (url.includes('/rest/v1/car_search_display')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BYD_ATTO_ROWS) });
        return true;
      }
      return false;
    },
  });

  await page.goto('/add');
  await expect(page.getByRole('heading', { name: /เพิ่มอะไหล่/ })).toBeVisible({ timeout: 15000 });

  const carInput = page.getByPlaceholder(/ยี่ห้อ|รุ่น|ค้นหา/).first();
  await carInput.fill('byd atto');
  await expect(page.getByText('Atto 3').first()).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Premium')).toBeVisible();

  expect(pageErrors, `Unexpected client-side JS errors: ${pageErrors.join('; ')}`).toEqual([]);
});
