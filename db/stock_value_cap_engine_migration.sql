-- ============================================================
-- Card: "Stock Value Cap Engine" (Priority: High, L — "ทำก่อนสุด เพราะ pricing table
-- ทั้งหมดพึ่งพาตัวนี้")
--
-- Scope this run actually built:
--   - Running counter on shops.current_stock_value, maintained by trigger on `parts`
--     (✅ ตัดสินใจแล้วในการ์ด: "running counter บน shops.current_stock_value (บวก/ลบ delta
--     ทันทีในทรานแซกชันเดียวกับการแก้อะไหล่)")
--   - State machine: under -> grace -> blocked, with the decided grace period (7 days) and the
--     decided "drop back under cap during grace -> resets to under immediately, no cron wait"
--   - Cap numbers per tier (✅ ตัดสินใจชั่วคราวแล้วในการ์ด — Trial 500,000 / Starter 1,000,000 /
--     Founder 3,000,000 / Pro 10,000,000 / Enterprise unlimited), stored in
--     config/subscriptionTiers.js per the card's own "Implementation note" (single source of
--     truth, no hardcoding scattered across files)
--   - Blocking one concrete feature when status='blocked': creating a new job (/jobs/new) — the
--     card's own acceptance criteria names this as its example ("เช่น สร้าง job ใหม่"); selling/
--     reducing stock remains allowed always (explicit card requirement, and untouched by this
--     migration since nothing here touches part_sales/checkout)
--
-- NOT implemented this run (documented, not silent):
--   - Cost formula only covers direct-purchase parts (parts.price * parts.quantity). The card's
--     own dependency note says this must eventually be "the same shared function as Stock Summary
--     Report" and include allocated_cost from disassembled salvage parts + remaining salvage
--     vehicle value — that requires the "Salvage cost allocation" card (still "edge cases to
--     design for", not started) to exist first. Until then, salvage-vehicle parts are counted at
--     their own parts.price like anything else (which may be 0/unset for freshly-disassembled
--     parts not yet priced) — this UNDERSTATES real stock value for shops using salvage
--     disassembly heavily. Flagged here explicitly so it isn't mistaken for a finished formula.
--   - Email notification on crossing the cap (no email-sending infra in this project yet, same
--     gap noted on the Onboarding Burst Mode card tonight) — in-app banner only.
--   - Nightly cron reconciliation of the counter against a real SUM() (✅ decided in the card, but
--     no scheduled-job mechanism exists/is decided in this project yet — same open question the
--     Field Scanner Role card already left unresolved: "Vercel cron หรือ Supabase pg_cron"). The
--     trigger-maintained delta counter should stay accurate on its own since every parts
--     INSERT/UPDATE/DELETE goes through it, but there's no automatic drift-repair yet if it ever
--     does (e.g. from a bulk direct-SQL edit bypassing the app).
--   - The full list of "blocked features" beyond job creation (card itself says this list is
--     still "กำกวม" / undecided)
--   - Null cost-per-item handling is treated as 0 (not blocking, not warning) — the card lists this
--     as an open ❓ ("นับ 0, บังคับกรอก, หรือเตือน") — 0 was chosen as the least disruptive default
-- ============================================================

alter table shops add column if not exists current_stock_value numeric not null default 0;
alter table shops add column if not exists stock_cap_status text not null default 'under'
  check (stock_cap_status in ('under', 'grace', 'blocked'));
alter table shops add column if not exists stock_cap_grace_started_at timestamptz;

-- ------------------------------------------------------------
-- ⚠️ Deliberate, flagged deviation from the card's "Implementation note" (เก็บตัวเลขใน
-- config/subscriptionTiers.js ที่เดียว ห้ามกระจาย): the trigger below needs the cap number at
-- the moment ANY parts row changes (every /add, /edit, /move-parts, salvage disassembly, CSV
-- import, etc. call site across the whole app) — requiring every one of those call sites to also
-- call a "please recalc my cap status" RPC afterwards would be dozens of edits across the
-- codebase for tonight's time budget, and any site someone forgets to update would silently drift.
-- Instead this SQL function mirrors the SAME cap numbers as config/subscriptionTiers.js so the
-- trigger can look them up itself, fully self-contained in the DB. This DOES create a second
-- place the numbers live — if a human changes subscriptionTiers.js's stockValueCap values, this
-- function must be updated to match too, or the two will drift silently. Flagged clearly instead
-- of hidden; a cleaner fix later would be a `tier_configs` table both JS and SQL read from.
-- ------------------------------------------------------------
create or replace function fn_tier_stock_cap(p_plan text)
returns numeric
language sql
immutable
as $$
  select case p_plan
    when 'trial' then 500000
    when 'starter' then 1000000
    when 'founder' then 3000000
    when 'pro' then 10000000
    when 'enterprise' then null -- unlimited
    else 1000000 -- unknown plan -> fall back to Starter's cap (matches getTierConfig()'s own fallback)
  end;
$$;

-- ------------------------------------------------------------
-- Backfill: initialize current_stock_value from real data (only for shops that have parts;
-- shops with none stay at the column default of 0)
-- ------------------------------------------------------------
update shops s
set current_stock_value = coalesce((
  select sum(coalesce(p.price, 0) * coalesce(p.quantity, 0))
  from parts p
  where p.shop_id = s.shop_id and p.is_active = true
), 0)
where s.current_stock_value = 0; -- idempotent guard: skip shops already backfilled/non-zero

-- ------------------------------------------------------------
-- State machine transition, called after current_stock_value changes for a shop.
--
-- 🔒 security definer (added in the final verification pass tonight — see the note on
-- fn_update_shop_stock_value below for why this matters): this function UPDATEs `shops`, but
-- `shops`' own UPDATE RLS policy only allows owner/manager. Without security definer, calling
-- this from a trigger fired by a supervisor/technician/assistant editing `parts` (the roles that
-- do this dozens of times a day) would silently fail to update the row at all.
-- ------------------------------------------------------------
create or replace function fn_recalc_stock_cap_status(p_shop_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value numeric;
  v_status text;
  v_grace_started timestamptz;
  v_plan text;
  p_cap numeric;
begin
  select current_stock_value, stock_cap_status, stock_cap_grace_started_at, subscription_plan
    into v_value, v_status, v_grace_started, v_plan
  from shops where shop_id = p_shop_id;

  if v_value is null then
    return;
  end if;

  p_cap := fn_tier_stock_cap(v_plan);

  -- Enterprise / unlimited (p_cap is null): always under, never blocks
  if p_cap is null then
    if v_status <> 'under' then
      update shops set stock_cap_status = 'under', stock_cap_grace_started_at = null
      where shop_id = p_shop_id;
    end if;
    return;
  end if;

  if v_value <= p_cap then
    -- กลับมาต่ำกว่า cap แล้ว -> ปลดล็อกทันที ไม่ต้องรอ cron (ตัดสินใจแล้วในการ์ด)
    if v_status <> 'under' then
      update shops set stock_cap_status = 'under', stock_cap_grace_started_at = null
      where shop_id = p_shop_id;
    end if;
  else
    -- เกิน cap
    if v_status = 'under' then
      -- เพิ่งข้าม cap ครั้งแรก -> เริ่มนับ grace 7 วัน
      update shops set stock_cap_status = 'grace', stock_cap_grace_started_at = now()
      where shop_id = p_shop_id;
    elsif v_status = 'grace' then
      if v_grace_started is not null and now() >= v_grace_started + interval '7 days' then
        update shops set stock_cap_status = 'blocked' where shop_id = p_shop_id;
      end if;
      -- ยังอยู่ใน grace period ปกติ -> ไม่ต้องทำอะไรเพิ่ม
    end if;
    -- ถ้า blocked อยู่แล้วและยังเกิน cap -> คงสถานะ blocked ต่อไป
  end if;
end;
$$;

-- ------------------------------------------------------------
-- Trigger: adjust the running counter by the delta whenever a part's contribution to stock
-- value changes (price * quantity), in the SAME transaction as the parts edit (decided in card),
-- then immediately re-run the state machine — fully self-contained, no app call site needs to
-- remember to call anything extra after writing to `parts`.
--
-- 🔒 security definer (real bug found in tonight's final verification pass, not caught by
-- Playwright since those tests mock the network layer and never touch real RLS): `parts` can be
-- edited by owner/manager/supervisor/technician/assistant, but `shops` UPDATE RLS only allows
-- owner/manager. A plain (non-definer) trigger function runs with the INVOKING user's RLS
-- privileges — so a supervisor/technician/assistant editing a part (routine, happens constantly)
-- would fire this trigger, hit `update shops ...`, and have it silently blocked by RLS: 0 rows
-- affected, no error surfaced, and the running counter would quietly drift out of sync for the
-- majority of real day-to-day usage. security definer makes this trigger run with the
-- function-owner's privileges instead, bypassing that RLS gap for this one controlled write.
-- ------------------------------------------------------------
create or replace function fn_update_shop_stock_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id bigint;
  v_old_value numeric;
  v_new_value numeric;
begin
  if tg_op = 'DELETE' then
    v_shop_id := old.shop_id;
    v_old_value := coalesce(old.price, 0) * coalesce(old.quantity, 0) * (case when old.is_active then 1 else 0 end);
    v_new_value := 0;
  elsif tg_op = 'INSERT' then
    v_shop_id := new.shop_id;
    v_old_value := 0;
    v_new_value := coalesce(new.price, 0) * coalesce(new.quantity, 0) * (case when new.is_active then 1 else 0 end);
  else -- UPDATE
    v_shop_id := new.shop_id;
    v_old_value := coalesce(old.price, 0) * coalesce(old.quantity, 0) * (case when old.is_active then 1 else 0 end);
    v_new_value := coalesce(new.price, 0) * coalesce(new.quantity, 0) * (case when new.is_active then 1 else 0 end);
  end if;

  if v_shop_id is not null and v_new_value <> v_old_value then
    update shops set current_stock_value = current_stock_value + (v_new_value - v_old_value)
    where shop_id = v_shop_id;
    -- ทำในทรานแซกชันเดียวกันเลย (ตัดสินใจแล้วในการ์ด) ไม่ต้องพึ่งแอปเรียก RPC แยกทีหลัง —
    -- กันเคส call site ไหนลืมเรียก แล้ว counter/status ไม่ sync กัน
    perform fn_recalc_stock_cap_status(v_shop_id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_update_shop_stock_value on parts;
create trigger trg_update_shop_stock_value
  after insert or update or delete on parts
  for each row execute function fn_update_shop_stock_value();

-- ------------------------------------------------------------
-- เผื่อ upgrade/downgrade tier (เปลี่ยน subscription_plan) โดยไม่มีการแก้ parts เลย — cap ใหม่ต้อง
-- เช็คทันที (ตัดสินใจแล้วในการ์ด: "Upgrade tier ระหว่าง grace -> cap ใหม่สูงกว่า -> ปลดทันที",
-- "Downgrade tier -> เกิน cap ใหม่ทันที -> เข้า grace ใหม่")
-- ------------------------------------------------------------
create or replace function fn_recheck_stock_cap_on_plan_change()
returns trigger
language plpgsql
as $$
begin
  if new.subscription_plan is distinct from old.subscription_plan then
    perform fn_recalc_stock_cap_status(new.shop_id);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_recheck_stock_cap_on_plan_change on shops;
create trigger trg_recheck_stock_cap_on_plan_change
  after update on shops
  for each row execute function fn_recheck_stock_cap_on_plan_change();

-- ------------------------------------------------------------
-- Verification queries (run manually after applying):
--   select shop_id, current_stock_value, stock_cap_status from shops;
--   -- cross-check counter against a real SUM (should match, confirms trigger math correct):
--   select s.shop_id, s.current_stock_value,
--          (select coalesce(sum(coalesce(p.price,0)*coalesce(p.quantity,0)),0)
--           from parts p where p.shop_id = s.shop_id and p.is_active = true) as real_sum
--   from shops s;
-- ------------------------------------------------------------
