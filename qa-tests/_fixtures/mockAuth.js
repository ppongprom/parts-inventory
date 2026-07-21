// Shared test fixture: simulates a logged-in "qa_owner" session entirely offline.
//
// WHY THIS EXISTS: this sandbox's outbound network cannot reach *.supabase.co
// (see README notes for this run). The app's AuthProvider/RequireAuth gate needs
// a Supabase session + a few REST/RPC calls to resolve before any protected page
// renders, and those calls hang forever with no network (no .catch on the initial
// getSession() promise). To still exercise protected-page UI logic in this sandbox,
// we (a) seed localStorage with a valid-shaped (unsigned) session so the client
// treats itself as logged in without a network round-trip, and (b) intercept the
// handful of REST/RPC calls AuthProvider fires on mount and answer them locally.
//
// This does NOT prove the real Supabase integration works end-to-end — only that
// the React/Next.js code path for an authenticated user behaves correctly. Full
// live E2E (real login, real RLS, real data) must run somewhere with network
// access to the staging project (local machine / CI), same caveat already
// documented in this project's own qa-automation README for *.vercel.app access.

const PROJECT_REF = "qmqabtrrubqcmafietsr";

const QA_USER = {
  id: "a11d07c6-0c2e-49b6-ba64-85a3d6f7cee5",
  email: "qa_owner@testshop.com",
};

function fakeJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.fakesignature`;
}

async function installMockAuth(page, { role = "owner", shopId = "11111111-1111-1111-1111-111111111111", shopName = "QA Test Shop", memberships = null, extraRoutes = null } = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessToken = fakeJwt({ sub: QA_USER.id, email: QA_USER.email, role: "authenticated", exp: nowSec + 3600 });

  const session = {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: nowSec + 3600,
    refresh_token: "fake-refresh-token",
    user: {
      id: QA_USER.id,
      aud: "authenticated",
      role: "authenticated",
      email: QA_USER.email,
      email_confirmed_at: "2026-07-16T17:31:05Z",
      app_metadata: {},
      user_metadata: {},
    },
  };

  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]
  );

  const membershipRows =
    memberships ||
    [
      {
        member_id: "22222222-2222-2222-2222-222222222222",
        shop_id: shopId,
        role,
        status: "active",
        login_username: null,
        contact_name: "QA Owner",
        shops: { shop_name: shopName, subscription_status: "active", subscription_plan: "pro" },
      },
    ];

  await page.route(`**/*.supabase.co/**`, async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes("/auth/v1/user")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
    }
    if (url.includes("/auth/v1/token")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) });
    }
    if (url.includes("/rest/v1/rpc/accept_pending_invites")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    }
    if (url.includes("/rest/v1/shop_members")) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(membershipRows) });
    }
    if (url.includes("/rest/v1/user_sessions")) {
      if (method === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([{ session_id: "33333333-3333-3333-3333-333333333333" }]),
        });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    if (extraRoutes) {
      const handled = await extraRoutes(route, url, method);
      if (handled) return;
    }
    // ค่า default: ถือว่าร้านนี้ "ยอมรับ ToS เวอร์ชันปัจจุบันแล้ว" เสมอ (การ์ด "กลไก ToS consent" —
    // TosConsentGate ครอบทุกหน้าที่ผ่าน RequireAuth อยู่แล้ว) ไม่งั้นทุกเทสที่มีอยู่ก่อนหน้าการ์ดนี้
    // จะเจอ gate บล็อกหน้าจอทันทีโดยไม่ได้ตั้งใจ — เทสที่อยากทดสอบ gate เองต้องส่ง extraRoutes มา
    // ดัก `/rest/v1/shop_tos_acceptances` เองก่อนถึงจุดนี้ (ดู card-tos-consent.spec.js)
    if (url.includes("/rest/v1/shop_tos_acceptances")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ tos_version: "__mock_always_accepted__", accepted_at: "2026-01-01T00:00:00Z" }]),
      });
    }
    // Default: succeed with empty payload so unhandled calls don't hang the page.
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
}

module.exports = { installMockAuth, QA_USER, PROJECT_REF };
