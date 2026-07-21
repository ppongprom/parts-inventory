// Card: "Onboarding Burst Mode — Requester/Approver workflow" (Priority: Highest, M-L)
//
// Scope this run actually built — see db/onboarding_burst_mode_migration.sql header for the 4
// unresolved ❓ decisions from the card that are NOT implemented (deliberately, not by oversight):
// Trial->Paid mid-cycle math, request time window, per-tier 20-account cap, auto-expiring a
// pending request. Also not implemented: email/in-app T-5/T-1 notifications (no email infra yet).
//
// What IS implemented and tested here: the Requester (Manager) / Approver (Owner) workflow on
// /admin/team, enforced by role checks in the API (not just hidden buttons), plus the one-extension
// limit. The 20-account cap and concurrent-session exclusion for field_scanner are server/DB-only
// changes (create-staff route, lib/sessionTracking.js) with no UI surface to assert against here.
const { test, expect } = require("@playwright/test");
const { installMockAuth } = require("./_fixtures/mockAuth");

const SHOP_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "m-scanner-burst-1";
const REQUEST_ID = 777;

function memberRow(overrides = {}) {
  return {
    member_id: MEMBER_ID,
    role: "field_scanner",
    status: "active",
    login_username: "scanner01",
    contact_name: "พนักงานสแกน เบิร์สต์",
    expires_at: "2026-08-01T00:00:00Z",
    burst_cycle_type: "trial",
    burst_extended: false,
    pending_extension_request: null,
    ...overrides,
  };
}

async function mockTeamPage(page, { members, extensionCapture = null, respondCapture = null }) {
  await page.route("**/api/team/list-with-emails", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: members }) });
  });
  await page.route("**/rest/v1/shop_invites*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/api/team/burst-mode-extension", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "request" && extensionCapture) extensionCapture.push(body);
    if (body.action === "respond" && respondCapture) respondCapture.push(body);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { ok: true } }) });
  });
}

test.describe("Onboarding Burst Mode — extension request (Manager) on /admin/team", () => {
  test("manager sees 'ขอต่ออายุ' for a not-yet-extended burst account and can request it", async ({ page }) => {
    const extensionCapture = [];
    await installMockAuth(page, { role: "manager", shopId: SHOP_ID });
    await mockTeamPage(page, { members: [memberRow()], extensionCapture });

    await page.goto("/admin/team");
    await expect(page.getByText("พนักงานสแกน เบิร์สต์")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "ขอต่ออายุ" }).click();

    await expect.poll(() => extensionCapture.length).toBeGreaterThan(0);
    expect(extensionCapture[0]).toMatchObject({ action: "request", member_id: MEMBER_ID, shop_id: SHOP_ID });
    await expect(page.getByText("ส่งคำขอต่ออายุแล้ว")).toBeVisible();
  });

  test("no 'ขอต่ออายุ' button once burst_extended is already true (one extension used)", async ({ page }) => {
    await installMockAuth(page, { role: "manager", shopId: SHOP_ID });
    await mockTeamPage(page, { members: [memberRow({ burst_extended: true })] });

    await page.goto("/admin/team");
    await expect(page.getByText("พนักงานสแกน เบิร์สต์")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/ต่ออายุไปแล้ว 1 ครั้ง/)).toBeVisible();
    await expect(page.getByRole("button", { name: "ขอต่ออายุ" })).toHaveCount(0);
  });

  test("a pending request shows 'รอเจ้าของอู่อนุมัติ' to the manager, not approve/reject buttons", async ({ page }) => {
    await installMockAuth(page, { role: "manager", shopId: SHOP_ID });
    await mockTeamPage(page, {
      members: [memberRow({ pending_extension_request: { request_id: REQUEST_ID, status: "pending" } })],
    });

    await page.goto("/admin/team");
    await expect(page.getByText("พนักงานสแกน เบิร์สต์")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("รอเจ้าของอู่อนุมัติการต่ออายุ")).toBeVisible();
    await expect(page.getByRole("button", { name: "✓ อนุมัติต่ออายุ" })).toHaveCount(0);
  });
});

test.describe("Onboarding Burst Mode — approve/reject (Owner) on /admin/team", () => {
  test("owner sees approve/reject buttons for a pending request and approving sends the right payload", async ({
    page,
  }) => {
    const respondCapture = [];
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockTeamPage(page, {
      members: [memberRow({ pending_extension_request: { request_id: REQUEST_ID, status: "pending" } })],
      respondCapture,
    });

    await page.goto("/admin/team");
    await expect(page.getByText("พนักงานสแกน เบิร์สต์")).toBeVisible({ timeout: 15000 });

    await page.getByRole("button", { name: "✓ อนุมัติต่ออายุ" }).click();

    await expect.poll(() => respondCapture.length).toBeGreaterThan(0);
    expect(respondCapture[0]).toMatchObject({
      action: "respond",
      request_id: REQUEST_ID,
      decision: "approved",
      shop_id: SHOP_ID,
    });
    await expect(page.getByText("บันทึกผลแล้ว")).toBeVisible();
  });

  test("owner does not see 'ขอต่ออายุ' (that's Manager's action, not Owner's)", async ({ page }) => {
    await installMockAuth(page, { role: "owner", shopId: SHOP_ID });
    await mockTeamPage(page, { members: [memberRow()] });

    await page.goto("/admin/team");
    await expect(page.getByText("พนักงานสแกน เบิร์สต์")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "ขอต่ออายุ" })).toHaveCount(0);
  });
});
