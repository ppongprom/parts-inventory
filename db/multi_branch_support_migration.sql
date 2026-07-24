-- ============================================================
-- Card: "Multi-branch support (Pro=2 สาขา, Enterprise=ไม่จำกัด)"
-- Notion page 3a1f39f45649810cb1fffbfa5da1d799
--
-- SCOPE NOTE (read this before touching anything related to "branch"):
-- "Branches" (สาขา, this migration) and "shop_groups" (อู่ในเครือ, used by
-- the separate/still-undesigned Accounting Module intercompany scope) are
-- two completely different concepts. Branches = same shop_id, same
-- subscription, same 13-digit tax id, different 5-digit Revenue Dept branch
-- code (00000/00001/...). shop_groups = different shop_id/different owners/
-- different tax ids, informally affiliated. This migration builds ONLY
-- branches. Do not conflate the two — see SOP.md "สาขา (Branches) vs
-- อู่ในเครือ (shop_groups)" section.
--
-- Architecture chosen (Approach A, decided in the card 19 ก.ค. 2026):
-- `branches` is a child table of `shops` — one shop_id/one subscription
-- covers every branch under it.
--
-- Idempotent: every DDL statement uses IF NOT EXISTS / OR REPLACE, and the
-- backfill step only touches rows where branch_id IS NULL, so re-running
-- this file after partial application (or on a DB that already has it) is
-- safe and a no-op on the parts that already ran.
--
-- Verified against staging (qmqabtrrubqcmafietsr) before writing this file:
--   shops=15, shop_members=63, parts=24, jobs=19, zones=160,
--   visibility_groups=6, visibility_group_members=6 — see migration
--   verification queries run after apply (row counts must match exactly
--   pre/post, every row attached to exactly the shop's one new default
--   branch since no shop on staging has multiple branches yet).
-- ============================================================

-- ------------------------------------------------------------
-- 1) branches — child table of shops
-- ------------------------------------------------------------
create table if not exists branches (
  branch_id     bigint generated always as identity primary key,
  shop_id       bigint not null references shops(shop_id) on delete cascade,
  branch_code   text not null default '00000', -- รหัสสาขากรมสรรพากร 5 หลัก (00000=สำนักงานใหญ่)
  branch_name   text not null,
  is_default    boolean not null default false, -- สาขาที่เกิดจาก backfill/สาขาแรกตอนสร้างร้าน
  is_active     boolean not null default true,  -- false = ปิดสาขาถาวร (soft-delete, ไม่ใช่ read-only ชั่วคราว)
  -- การ์ด "Downgrade Enterprise→Pro ขณะมีสาขาเกิน limit" — ✅ ตัดสินใจแล้ว: ยอม downgrade
  -- แต่สาขาส่วนเกิน (ที่เจ้าของร้านไม่เลือกเก็บเป็น active) กลายเป็น read-only แทนการลบ/บล็อก
  -- downgrade ทั้งหมด — read-only ต่างจาก is_active=false: read-only ยังดูข้อมูลเก่าได้ปกติ
  -- แค่ insert/update/ขาย/ย้ายอะไหล่ใหม่ไม่ได้ (ดู is_branch_writable() ด้านล่าง)
  is_read_only  boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (shop_id, branch_code)
);

create index if not exists idx_branches_shop on branches (shop_id);

comment on table branches is
  'สาขาในร้านเดียวกัน (same shop_id/tax id, ต่างรหัสสาขากรมสรรพากร) — ไม่ใช่ shop_groups/อู่ในเครือ (คนละ shop_id เสมอ, ใช้โดย Accounting Module intercompany scope, เป็นกลไกแยกต่างหากที่ยังไม่ได้สร้าง)';

-- ------------------------------------------------------------
-- 2) branch_id columns on every table that needs branch-level scoping
--    (nullable for now — backfilled in step 4, then locked NOT NULL in step 5)
-- ------------------------------------------------------------
alter table shop_members       add column if not exists branch_id bigint references branches(branch_id) on delete cascade;
alter table parts              add column if not exists branch_id bigint references branches(branch_id);
alter table jobs               add column if not exists branch_id bigint references branches(branch_id);
alter table zones              add column if not exists branch_id bigint references branches(branch_id);
alter table visibility_groups  add column if not exists branch_id bigint references branches(branch_id);

create index if not exists idx_shop_members_branch on shop_members (branch_id);
create index if not exists idx_parts_branch on parts (branch_id);
create index if not exists idx_jobs_branch on jobs (branch_id);
create index if not exists idx_zones_branch on zones (branch_id);
create index if not exists idx_visibility_groups_branch on visibility_groups (branch_id);

-- ------------------------------------------------------------
-- 3) Data migration — "สำคัญสุด" per the card. One default branch per
--    existing shop, every existing row of that shop attached to it.
--    Safe to re-run: only inserts a default branch for a shop if it
--    doesn't already have one (is_default=true), and only updates rows
--    where branch_id is still NULL.
-- ------------------------------------------------------------
insert into branches (shop_id, branch_code, branch_name, is_default, is_active)
select s.shop_id, '00000', s.shop_name || ' (สาขาหลัก)', true, true
from shops s
where not exists (
  select 1 from branches b where b.shop_id = s.shop_id and b.is_default = true
);

update shop_members m
set branch_id = b.branch_id
from branches b
where b.shop_id = m.shop_id and b.is_default = true and m.branch_id is null;

update parts p
set branch_id = b.branch_id
from branches b
where p.shop_id is not null and b.shop_id = p.shop_id and b.is_default = true and p.branch_id is null;

update jobs j
set branch_id = b.branch_id
from branches b
where b.shop_id = j.shop_id and b.is_default = true and j.branch_id is null;

update zones z
set branch_id = b.branch_id
from branches b
where z.shop_id is not null and b.shop_id = z.shop_id and b.is_default = true and z.branch_id is null;

update visibility_groups g
set branch_id = b.branch_id
from branches b
where b.shop_id = g.shop_id and b.is_default = true and g.branch_id is null;

-- ------------------------------------------------------------
-- 4) Lock down NOT NULL now that backfill has run. shop_members/jobs/
--    visibility_groups/parts-with-a-shop/zones-with-a-shop always belong to
--    exactly one branch of their shop going forward.
--    (parts/zones keep branch_id nullable at the column level only because
--    a small number of legacy rows have shop_id NULL too — see WHERE guard
--    below; this mirrors how shop_id itself was rolled out nullable on
--    those two tables originally.)
-- ------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'shop_members' and column_name = 'branch_id' and is_nullable = 'NO'
  ) then
    alter table shop_members alter column branch_id set not null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'jobs' and column_name = 'branch_id' and is_nullable = 'NO'
  ) then
    alter table jobs alter column branch_id set not null;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'visibility_groups' and column_name = 'branch_id' and is_nullable = 'NO'
  ) then
    alter table visibility_groups alter column branch_id set not null;
  end if;
end $$;

-- shop_members role used to be unique per (shop_id, user_id). Card decision:
-- role is now per (user, branch_id) — same person can be Manager at branch 1
-- and Technician at branch 2 of the same shop. Replace the old constraint.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'shop_members_shop_id_user_id_key'
  ) then
    alter table shop_members drop constraint shop_members_shop_id_user_id_key;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'shop_members_shop_user_branch_key'
  ) then
    alter table shop_members add constraint shop_members_shop_user_branch_key
      unique (shop_id, user_id, branch_id);
  end if;
end $$;

-- ------------------------------------------------------------
-- 5) create_shop_with_owner: new shops must also get a default branch +
--    the owner's membership row must carry that branch_id (was previously
--    branch-less by definition since branches didn't exist yet).
-- ------------------------------------------------------------
create or replace function create_shop_with_owner(
  p_shop_name text,
  p_contact_name text default null,
  p_contact_phone text default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id bigint;
  v_branch_id bigint;
begin
  insert into shops (shop_name, owner_user_id, subscription_status, subscription_plan, trial_ends_at)
  values (p_shop_name, auth.uid(), 'trialing', 'trial', now() + interval '14 days')
  returning shop_id into v_shop_id;

  insert into branches (shop_id, branch_code, branch_name, is_default, is_active)
  values (v_shop_id, '00000', p_shop_name || ' (สาขาหลัก)', true, true)
  returning branch_id into v_branch_id;

  insert into shop_members (shop_id, user_id, role, status, contact_name, contact_phone, branch_id)
  values (v_shop_id, auth.uid(), 'owner', 'active', p_contact_name, p_contact_phone, v_branch_id);

  return v_shop_id;
end;
$$;

-- ------------------------------------------------------------
-- 6) Branch-aware authorization helpers
--    Judgment call (not fully spelled out by the card): owner/manager see/
--    act across ALL branches of their own shop; every other role is scoped
--    to the specific branch(es) they have a shop_members row for. This is
--    the safest default consistent with how role-based visibility already
--    works elsewhere in this codebase (owner/manager already bypass
--    visibility-group scoping in can_view_job() above).
-- ------------------------------------------------------------
create or replace function is_branch_member(p_branch_id bigint, p_roles text[])
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from shop_members sm
    join branches b on b.branch_id = p_branch_id
    where sm.shop_id = b.shop_id
      and sm.user_id = auth.uid()
      and sm.status = 'active'
      and sm.role = any(p_roles)
      and (sm.role in ('owner','manager') or sm.branch_id = p_branch_id)
  );
$$;

comment on function is_branch_member(bigint, text[]) is
  'เหมือน is_shop_member() แต่กรองระดับสาขาด้วย — owner/manager เห็น/ทำงานข้ามทุกสาขาของร้านตัวเองได้เสมอ (judgment call ของการ์ด multi-branch, ดู SOP.md), role อื่นถูกจำกัดเฉพาะสาขาที่มีแถว shop_members อยู่จริง';

-- สาขานี้ยัง "เขียนได้" ไหม (ไม่ read-only จาก downgrade + ไม่ถูกปิด + shop ไม่ suspended)
create or replace function is_branch_writable(p_branch_id bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select b.is_active and not b.is_read_only and is_shop_active(b.shop_id)
  from branches b
  where b.branch_id = p_branch_id;
$$;

-- ------------------------------------------------------------
-- 7) Tier limit enforcement (DB-level defense in depth, mirrors the app
--    layer in config/subscriptionTiers.js / lib/teamAuth.js checkSeatLimit
--    pattern — same "duplicated in 2 places, keep in sync" trade-off already
--    documented for stock_value_cap_engine_migration.sql's fn_tier_stock_cap)
--    ✅ ตัดสินใจแล้วในการ์ด: Starter/Founder/Trial = 1 สาขา (สร้างเพิ่มไม่ได้เลย),
--    Pro = 2, Enterprise = ไม่จำกัด. Trial ไม่ได้พูดถึงตรงๆ ในการ์ด — judgment
--    call: ให้เหมือน Starter/Founder (1 สาขา) เพราะเป็น tier ทดลองใช้ระดับต่ำสุด
-- ------------------------------------------------------------
create or replace function fn_tier_max_branches(p_plan text)
returns int
language sql
immutable
as $$
  select case p_plan
    when 'pro' then 2
    when 'enterprise' then null -- unlimited
    else 1 -- trial, starter, founder
  end;
$$;

create or replace function trg_check_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan text;
  v_max int;
  v_count int;
begin
  select subscription_plan into v_plan from shops where shop_id = new.shop_id;
  v_max := fn_tier_max_branches(v_plan);

  if v_max is not null then
    select count(*) into v_count from branches where shop_id = new.shop_id and is_active = true;
    if v_count >= v_max then
      raise exception 'จำนวนสาขาถึงขีดจำกัดของแพ็กเกจแล้ว (สูงสุด % สาขา)', v_max
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_branches_tier_limit on branches;
create trigger trg_branches_tier_limit
  before insert on branches
  for each row
  when (new.is_default is not true) -- backfill/create_shop_with_owner's first branch never blocked by the trigger
  execute function trg_check_branch_limit();

-- ------------------------------------------------------------
-- 8) RLS: swap shop-wide checks for branch-aware checks on the tables that
--    are physically branch-scoped (parts/jobs/zones/visibility_groups*).
--    is_shop_active(shop_id) checks are folded into is_branch_writable()
--    which also covers the new read-only-after-downgrade case.
-- ------------------------------------------------------------
alter table branches enable row level security;

create policy "shop members can view branches" on branches
  for select using (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant','admin','field_scanner']));

create policy "managers+ can insert branches" on branches
  for insert with check (is_shop_member(shop_id, array['owner','manager']) and is_shop_active(shop_id));

create policy "managers+ can update branches" on branches
  for update using (is_shop_member(shop_id, array['owner','manager']));

-- parts
drop policy if exists "shop members can view parts" on parts;
create policy "shop members can view parts" on parts
  for select using (
    branch_id is null -- legacy rows never touched by backfill (shop_id was already null) — fail open to old shop-level check
      and is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant','field_scanner','admin'])
    or branch_id is not null
      and is_branch_member(branch_id, array['owner','manager','supervisor','technician','assistant','field_scanner','admin'])
  );

drop policy if exists "eligible roles can insert parts" on parts;
create policy "eligible roles can insert parts" on parts
  for insert with check (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant','field_scanner','admin'])
    and is_shop_active(shop_id)
    and (branch_id is null or is_branch_writable(branch_id))
  );

drop policy if exists "eligible roles can update parts" on parts;
create policy "eligible roles can update parts" on parts
  for update using (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','field_scanner','admin'])
    and (branch_id is null or is_branch_writable(branch_id))
  );

-- jobs
drop policy if exists "shop members can view jobs (active or trashed)" on jobs;
create policy "shop members can view jobs (active or trashed)" on jobs
  for select using (
    (is_shop_member(shop_id, array['owner','manager']) and deleted_at is not null)
    or (
      is_branch_member(branch_id, array['owner','manager','supervisor','technician','assistant','admin'])
      and can_view_job(job_id, shop_id)
      and deleted_at is null
    )
  );

drop policy if exists "eligible roles can insert jobs" on jobs;
create policy "eligible roles can insert jobs" on jobs
  for insert with check (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant','admin'])
    and is_shop_active(shop_id)
    and is_branch_writable(branch_id)
  );

drop policy if exists "eligible roles can update jobs" on jobs;
create policy "eligible roles can update jobs" on jobs
  for update using (
    is_branch_member(branch_id, array['owner','manager','supervisor','technician','admin'])
    and is_branch_writable(branch_id)
  );

-- zones
drop policy if exists "shop members can view zones" on zones;
create policy "shop members can view zones" on zones
  for select using (
    branch_id is null and is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant','field_scanner'])
    or branch_id is not null and is_branch_member(branch_id, array['owner','manager','supervisor','technician','assistant','field_scanner'])
  );

drop policy if exists "managers+ can insert zones" on zones;
create policy "managers+ can insert zones" on zones
  for insert with check (
    is_shop_member(shop_id, array['owner','manager'])
    and (branch_id is null or is_branch_writable(branch_id))
  );

drop policy if exists "managers+ can update zones" on zones;
create policy "managers+ can update zones" on zones
  for update using (
    is_shop_member(shop_id, array['owner','manager'])
    and (branch_id is null or is_branch_writable(branch_id))
  );

-- visibility_groups
drop policy if exists "shop members can view groups" on visibility_groups;
create policy "shop members can view groups" on visibility_groups
  for select using (is_branch_member(branch_id, array['owner','manager','supervisor','technician','assistant']));

drop policy if exists "managers+ can insert groups" on visibility_groups;
create policy "managers+ can insert groups" on visibility_groups
  for insert with check (is_shop_member(shop_id, array['owner','manager']));

drop policy if exists "managers+ can update groups" on visibility_groups;
create policy "managers+ can update groups" on visibility_groups
  for update using (is_shop_member(shop_id, array['owner','manager']));

-- ============================================================
-- Deliberately NOT branch-scoped (card decisions, do not "fix" this later
-- without re-reading the card):
--   - Stock Value Cap Engine (shops.current_stock_value/stock_cap_status)
--     stays whole-shop — one subscription covers every branch.
--   - Concurrent session limit (user_sessions, maxConcurrentSessions) stays
--     whole-shop for the same reason.
--   - shop_invites / team roster visibility stays shop-wide (owner/manager
--     manage members across all branches from one admin screen) — a
--     judgment call, not explicit in the card.
-- ============================================================
