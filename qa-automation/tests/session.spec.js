import { test, expect } from "@playwright/test";
import { loginWithEmail, expectLoginSucceeded, signOut } from "../fixtures/auth-helpers.js";
import { accounts } from "../fixtures/test-data.js";
import { GLOBAL_SESSION_CONFIG } from "../../config/subscriptionTiers.js";

const IDLE_TIMEOUT_MINUTES = GLOBAL_SESSION_CONFIG.idleTimeoutMinutes;
const WARNING_COUNTDOWN_SECONDS = GLOBAL_SESSION_CONFIG.idleWarningCountdownSeconds;

test.describe("Session — Idle timeout (lib/useIdleTimeout.js + components/IdleLogoutModal.js)", () => {
  // TC-301
  test("TC-301 idle ครบ 15 นาที -> ขึ้น modal นับถอยหลัง -> ปล่อยจนหมดเวลา -> logout ไป /login?reason=idle", async ({
    page,
    context,
  }) => {
    await context.clock?.install?.(); // Playwright >=1.45 clock API
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    // fast-forward เวลาผ่าน idleTimeoutMinutes โดยไม่มี activity event ใดๆ
    await page.clock.fastForward((IDLE_TIMEOUT_MINUTES * 60 + 1) * 1000);

    // ต้องเห็น modal เตือนก่อน logout จริง
    await expect(page.getByText("ไม่มีการใช้งาน")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "ยังใช้งานอยู่" })).toBeVisible();

    // fast-forward ต่อจนครบ countdown โดยไม่กด "ยังใช้งานอยู่"
    await page.clock.fastForward((WARNING_COUNTDOWN_SECONDS + 1) * 1000);

    await expect(page).toHaveURL(/\/login\?reason=idle/, { timeout: 8000 });
    await expect(page.getByText("ระบบออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน")).toBeVisible();
  });

  test("Idle warning: กด 'ยังใช้งานอยู่' แล้วต้อง reset ไม่ logout", async ({ page, context }) => {
    await context.clock?.install?.();
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    await page.clock.fastForward((IDLE_TIMEOUT_MINUTES * 60 + 1) * 1000);
    await expect(page.getByText("ไม่มีการใช้งาน")).toBeVisible({ timeout: 5000 });

    await page.getByRole("button", { name: "ยังใช้งานอยู่" }).click();
    await expect(page.getByText("ไม่มีการใช้งาน")).toHaveCount(0);

    // ต่อให้ fast-forward เกิน countdown เดิมไปแล้ว ก็ไม่ควร logout เพราะ timer ถูก reset ใหม่
    await page.clock.fastForward((WARNING_COUNTDOWN_SECONDS + 5) * 1000);
    await expect(page).not.toHaveURL(/\/login/);
  });
});

test.describe("Session — Sign out", () => {
  // TC-303
  test("TC-303 sign out แล้วกลับเข้าหน้า protected ซ้ำไม่ได้ ต้อง redirect ไป /login", async ({
    page,
  }) => {
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);

    const protectedUrl = page.url();
    await signOut(page);
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });

    // จำลองการกด back ของ browser / เรียกหน้า protected ซ้ำตรงๆ
    await page.goto(protectedUrl);
    await expect(page).toHaveURL(/\/login/, { timeout: 8000 });
  });
});
