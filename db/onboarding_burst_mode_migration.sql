-- ============================================================
-- Card: "Onboarding Burst Mode — Requester/Approver workflow" (Priority: Highest, M-L)
--
-- Scope this run actually built — the well-decided mechanics only. The card itself lists 4
-- unresolved ❓ decisions that block a fully-confident implementation; rather than guess silently,
-- each assumption made below is called out explicitly so คุณอั้ม can confirm/correct it:
--
--   1. "Trial → Paid ระหว่างรอบ: ระยะรอบปัจจุบันขยายจาก 14 → 30 ไหม หรือรอบหน้าค่อยเปลี่ยน" — NOT
--      resolved by this migration. Implemented: cycle length (`burst_cycle_type`) is captured ONCE
--      at account-creation time from the shop's subscription_plan then and is fixed for that
--      account's whole lifetime (including its one extension) — it does NOT re-check the shop's
--      plan again later. If the shop upgrades mid-cycle, existing burst accounts keep their
--      original cycle length. This is an assumption, not a confirmed decision.
--   2. "ขอต่อได้ตั้งแต่เมื่อไหร่ (ก่อนหมดกี่วัน) / ขอย้อนหลังหลังหมดไปแล้วได้ไหม" — NOT resolved.
--      Implemented: no window restriction at all — a request can be submitted any time before the
--      account is permanently closed (burst_extended = true already used), including after
--      expires_at has passed. Deliberately permissive since the card doesn't specify a window.
--   3. "20 บัญชี fix ทุก plan หรือต่างตาม tier" — NOT resolved. Implemented: fixed 20 for all tiers
--      (matches the card's own "Day 0: อนุญาต... สูงสุด 20 บัญชี" wording, which does not qualify
--      it by tier anywhere).
--   4. "Owner ไม่ตอบจนหมดเขต → คำขอ expire อัตโนมัติ? ขอใหม่ได้ไหม (นับสิทธิ์ต่อรอบเดิมหรือใช้ไปแล้ว)"
--      — NOT resolved, and NOT implemented: a pending request just stays pending forever until an
--      Owner acts on it (approve/reject) or the account's one-extension slot is separately closed
--      by an approved request elsewhere. No auto-expiry of the request itself.
--
-- Also NOT implemented this run (infrastructure that doesn't exist yet, same reasoning the card's
-- own "Field Scanner Role" card used to defer the scheduled-job piece — "กลไก cron ยังไม่ตัดสินใจ"):
--   - Email/in-app notifications at T-5 and T-1 days (no email-sending infra in this project yet)
--   - Scheduled job that force-cuts ACTIVE sessions the moment an account expires (login-time
--     rejection already existed from the Field Scanner Role card and still applies)
-- ============================================================

-- ------------------------------------------------------------
-- 1) shop_members: which cycle a burst-mode field_scanner account is on, and whether its one
--    allowed extension has already been used
-- ------------------------------------------------------------
alter table shop_members add column if not exists burst_cycle_type text
  check (burst_cycle_type is null or burst_cycle_type in ('trial', 'paid'));

alter table shop_members add column if not exists burst_extended boolean not null default false;

-- ------------------------------------------------------------
-- 2) Extension requests — Manager requests, Owner approves/rejects (never the same person)
-- ------------------------------------------------------------
create table if not exists burst_mode_extension_requests (
  request_id    bigint generated always as identity primary key,
  shop_id       bigint not null references shops(shop_id),
  member_id     bigint not null references shop_members(member_id) on delete cascade,
  requested_by  uuid not null references auth.users(id),
  requested_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  responded_by  uuid references auth.users(id),
  responded_at  timestamptz
);

create index if not exists idx_burst_extension_requests_shop on burst_mode_extension_requests (shop_id);
create index if not exists idx_burst_extension_requests_member on burst_mode_extension_requests (member_id);

alter table burst_mode_extension_requests enable row level security;

-- ดู: owner/manager ของอู่นั้นดูได้ (เหมือน shop_members อื่นๆ)
drop policy if exists "owner/manager can view burst extension requests" on burst_mode_extension_requests;
create policy "owner/manager can view burst extension requests" on burst_mode_extension_requests
  for select using (is_shop_member(shop_id, array['owner', 'manager']));

-- สร้างคำขอ/อัปเดตสถานะ: ทำผ่าน API route เท่านั้น (app/api/team/burst-mode-extension) ที่ enforce
-- role แยกฝั่ง request (manager) vs respond (owner) อย่างเข้มงวดกว่าที่ RLS อธิบายง่ายๆ ได้ (ต้องกัน
-- "Manager approve คำขอตัวเอง" ตามการ์ด) — RLS ที่นี่เป็นแค่ชั้นป้องกันกว้างๆ ระดับ shop เสริมจาก API
drop policy if exists "owner/manager can manage burst extension requests" on burst_mode_extension_requests;
create policy "owner/manager can manage burst extension requests" on burst_mode_extension_requests
  for insert with check (is_shop_member(shop_id, array['owner', 'manager']));

drop policy if exists "owner/manager can update burst extension requests" on burst_mode_extension_requests;
create policy "owner/manager can update burst extension requests" on burst_mode_extension_requests
  for update using (is_shop_member(shop_id, array['owner', 'manager']))
  with check (is_shop_member(shop_id, array['owner', 'manager']));

-- ------------------------------------------------------------
-- Verification queries (run manually after applying):
--   select count(*) from shop_members where role = 'field_scanner' and burst_cycle_type is not null;
-- ------------------------------------------------------------
