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

    // ต้องรอให้ AppShell/IdleSessionGuard mount เสร็จจริงก่อน (ผ่าน RequireAuth's loading state)
    // ไม่งั้น setTimeout ของ useIdleTimeout อาจยังไม่ถูกสร้างตอนที่ fastForward รันไปแล้ว
    // — พอ effect มา register setTimeout ทีหลัง มันจะอิงจาก "เวลาปลอมตอนนี้" ที่ fast-forward
    // ไปไกลแล้ว กลายเป็นรอจริงอีก idleTimeoutMinutes นาทีที่เทสไม่ได้เผื่อไว้ (ดู error-context
    // จาก TC-301 รอบที่ fail — sidebar/ปุ่ม sign out render ปกติ แค่ modal ไม่เคยขึ้น)
    await expect(page.getByRole("button", { name: /ออกจากระบบ/ })).toBeVisible({ timeout: 10000 });

    // fast-forward เวลาผ่าน idleTimeoutMinutes โดยไม่มี activity event ใดๆ
    await page.clock.fastForward((IDLE_TIMEOUT_MINUTES * 60 + 1) * 1000);

    // ต้องเห็น modal เตือนก่อน logout จริง
    await expect(page.getByText("ไม่มีการใช้งาน")).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: "ยังใช้งานอยู่" })).toBeVisible();

    // ต่อจากนี้ต้องใช้ runFor ไม่ใช่ fastForward — countdown ใช้ setInterval ทุก 1 วิ นับถอยจนถึง 0
    // (react state update ทีละ tick) แต่ fastForward "fires due timers at most once" ต่อการเรียก
    // 1 ครั้ง (เจตนาไว้จำลอง "ปิดฝาโน้ตบุ๊กแล้วเปิดใหม่" ไม่ใช่ปล่อยเวลาไหลจริง) ถ้าใช้ fastForward
    // ก้อนเดียวข้าม 603 วิ setInterval จะ tick แค่ครั้งเดียว (603 -> 602) ไม่มีทางนับถึง 0 ทัน
    // ส่วน runFor จะ fire ทุก tick ที่ครบจริงให้ตามลำดับเวลา ใช้ตัวนี้เมื่อต้องพึ่ง setInterval
    // ที่ยังทำงานอยู่ (ดู https://playwright.dev/docs/api/class-clock)
    await page.clock.runFor((WARNING_COUNTDOWN_SECONDS + 1) * 1000);

    await expect(page).toHaveURL(/\/login\?reason=idle/, { timeout: 8000 });
    await expect(page.getByText("ระบบออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน")).toBeVisible();
  });

  test("Idle warning: กด 'ยังใช้งานอยู่' แล้วต้อง reset ไม่ logout", async ({ page, context }) => {
    await context.clock?.install?.();
    await loginWithEmail(page, accounts.owner.email, accounts.owner.password);
    await expectLoginSucceeded(page);
    await expect(page.getByRole("button", { name: /ออกจากระบบ/ })).toBeVisible({ timeout: 10000 });

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
