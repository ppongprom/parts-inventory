-- ============================================================
-- Card: "🔴 P0: Supabase Security Advisor batch (24 ก.ค. 2569) — RLS bypass บน
-- parts + accounting RPC ไม่เช็คสิทธิ์ + hygiene อื่นๆ" (Notion page
-- 3a7f39f45649817c85a3c1e2feca40dc)
--
-- Applied to STAGING only (qmqabtrrubqcmafietsr). Verified against the LIVE
-- schema via pg_policy/pg_get_functiondef/get_advisors right before writing this
-- (not just the card's original text) since Accounting Module, Multi-branch
-- support, and Field Visibility Whitelist all landed schema changes on staging
-- earlier the same day this card was written. Drift found vs the card, all
-- accounted for below:
--   - parts "estimated_value floor on insert/update" now also carries a
--     branch_id/is_branch_writable() clause (added by
--     multi_branch_support_migration.sql section 9) that the card's own SQL
--     snippet doesn't have — preserved verbatim below, only PERMISSIVE ->
--     RESTRICTIVE actually changes.
--   - Ironically, multi_branch_support_migration.sql's own commit message says
--     "Fix: Postgres RLS permissive policies are OR'd together, not AND'd" —
--     it fixed a *different* instance of this exact bug class (branch_id
--     read-only bypass) but in doing so re-created these two policies without
--     "as restrictive" (they'd briefly been correctly RESTRICTIVE since
--     salvage_vehicle_cost_allocation_migration.sql), regressing back to
--     PERMISSIVE. This migration restores RESTRICTIVE.
--   - Live PoC confirmed before this fix (rolled back, no data persisted):
--     a `technician` (not an elevated role) COULD set/overwrite
--     parts.estimated_value on their OWN shop's rows via plain
--     UPDATE/INSERT — the floor was not enforcing at all, because
--     "eligible roles can insert/update parts" is PERMISSIVE with no
--     estimated_value awareness, and permissive policies OR together (so its
--     unconditional true made the floor policy's condition irrelevant). The
--     purely cross-tenant vector the card focuses on (attacker with zero
--     membership in the target shop) turned out to already be blocked today by
--     the branch_id auto-fill trigger + is_branch_writable() combo for every
--     shop that currently has a branch (all of them do, per migration
--     backfill) — but that protection is incidental/fragile (depends on every
--     shop always having >=1 branch row, not a guaranteed invariant), so the
--     RESTRICTIVE fix is still the correct, necessary, defense-in-depth fix:
--     it closes the confirmed-live same-shop floor-escalation bug AND removes
--     the dependency on the branch_id coincidence for the cross-tenant case.
--   - Accounting module functions: fn_insert_system_journal_entry is called
--     internally by the part_sales AFTER trigger (fn_post_sale_journal_entry
--     -> fn_post_sale_journal_entry_body) whenever ANY of
--     owner/manager/supervisor/technician/assistant/admin completes a sale
--     (see "eligible roles can record sales" policy on part_sales) — NOT just
--     owner/manager. Gating fn_insert_system_journal_entry /
--     fn_get_or_open_period to owner/manager/supervisor only (as the card's
--     "match close_accounting_period" suggestion would do) would have broken
--     real sale completion for technician/assistant staff. Gated instead to
--     match part_sales' own actual role list. fn_recalc_stock_cap_status is
--     invoked by a trigger on every parts INSERT/UPDATE/DELETE (any of the 7
--     valid roles, including field_scanner, can trigger it) and by a shops
--     UPDATE trigger — gated to all 7 valid roles to avoid breaking routine
--     stock-cap bookkeeping for low-privilege staff. fn_backfill_current_
--     period_sales / fn_seed_default_chart_of_accounts have exactly one real
--     caller each (set_accounting_module_enabled, owner/manager) — gated to
--     match that sibling exactly.
--   - Live PoC confirmed before this fix (rolled back, nothing committed): an
--     authenticated `technician` of shop 4 (QA Test Shop) successfully (a)
--     injected a ฿9,999,999 fabricated journal entry into shop 5's ledger via
--     fn_insert_system_journal_entry, and (b) opened a brand new accounting
--     period for shop 5 via fn_get_or_open_period — zero membership in shop 5
--     required for either.
--
-- Idempotent throughout (drop policy if exists / create or replace / revoke
-- ... — safe to re-run).
-- ============================================================


-- ------------------------------------------------------------
-- P0-1: parts.estimated_value floor — PERMISSIVE -> RESTRICTIVE
-- (confirmed current with_check text preserved verbatim, incl. the branch_id
-- clause added by multi-branch support; only the PERMISSIVE->RESTRICTIVE
-- change is new here)
-- ------------------------------------------------------------
drop policy if exists "estimated_value floor on insert" on parts;
create policy "estimated_value floor on insert" on parts
  as restrictive
  for insert
  with check (
    ((estimated_value is null) or is_shop_member(shop_id, array['owner','manager','supervisor','admin']))
    and ((branch_id is null) or is_branch_writable(branch_id))
  );

drop policy if exists "estimated_value floor on update" on parts;
create policy "estimated_value floor on update" on parts
  as restrictive
  for update
  with check (
    ((estimated_value is null) or is_shop_member(shop_id, array['owner','manager','supervisor','admin']))
    and ((branch_id is null) or is_branch_writable(branch_id))
  );


-- ------------------------------------------------------------
-- P0-2: Accounting module RPCs missing authorization — add is_shop_member()
-- check matching each function's real caller convention (see notes above for
-- why the role lists differ per function instead of all matching
-- close_accounting_period)
-- ------------------------------------------------------------
-- NOTE: same PUBLIC-service-role subtlety as fn_recalc_stock_cap_status below -- this function
-- (and fn_get_or_open_period, next) is also reachable via the part_sales AFTER trigger chain
-- (fn_post_sale_journal_entry -> fn_post_sale_journal_entry_body) whenever a part_sales row is
-- written via SERVICE ROLE. Confirmed live: qa-automation/tests/accounting-module-core.spec.js's
-- own pre-existing ACC-004 test inserts part_sales via adminClient() (service role, auth.uid()
-- null) to exercise the auto-journal-entry trigger end to end -- a legitimate, already-validated
-- pattern (likely mirroring how a real bulk-import/admin-backend sale-recording path would work
-- too), not a test artifact. A blanket check broke it (confirmed via a live regression run of
-- that exact suite while building this fix). Guard on auth.uid() is not null, same as
-- fn_recalc_stock_cap_status.
create or replace function fn_insert_system_journal_entry(
  p_shop_id bigint,
  p_entry_date date,
  p_description text,
  p_source_type text,
  p_source_table text,
  p_source_id bigint,
  p_lines jsonb
)
returns journal_entries
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_period accounting_periods;
  v_entry journal_entries;
begin
  if auth.uid() is not null and not is_shop_member(p_shop_id, array['owner','manager','supervisor','technician','assistant','admin']) then
    raise exception 'ไม่มีสิทธิ์บันทึกรายการบัญชีสำหรับร้านนี้';
  end if;

  v_period := fn_get_or_open_period(p_shop_id, p_entry_date);

  insert into journal_entries (shop_id, period_id, entry_date, description, source_type, source_table, source_id, created_by)
  values (p_shop_id, v_period.period_id, p_entry_date, p_description, p_source_type, p_source_table, p_source_id, auth.uid())
  returning * into v_entry;

  insert into journal_entry_lines (entry_id, account_code, debit, credit, memo)
  select v_entry.entry_id, l->>'account_code', (l->>'debit')::numeric, (l->>'credit')::numeric, l->>'memo'
  from jsonb_array_elements(p_lines) l;

  return v_entry;
end;
$function$;

create or replace function fn_get_or_open_period(p_shop_id bigint, p_date date)
returns accounting_periods
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_period accounting_periods;
  v_label text;
  v_start date;
  v_end date;
begin
  if auth.uid() is not null and not is_shop_member(p_shop_id, array['owner','manager','supervisor','technician','assistant','admin']) then
    raise exception 'ไม่มีสิทธิ์เปิด/เข้าถึงงวดบัญชีของร้านนี้';
  end if;

  v_label := to_char(p_date, 'YYYY-MM');
  v_start := date_trunc('month', p_date)::date;
  v_end := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;

  select * into v_period from accounting_periods
  where shop_id = p_shop_id and period_label = v_label;

  if v_period is null then
    insert into accounting_periods (shop_id, period_label, period_start, period_end, status)
    values (p_shop_id, v_label, v_start, v_end, 'open')
    on conflict (shop_id, period_label) do nothing
    returning * into v_period;

    if v_period is null then
      select * into v_period from accounting_periods
      where shop_id = p_shop_id and period_label = v_label;
    end if;
  end if;

  return v_period;
end;
$function$;

create or replace function fn_backfill_current_period_sales(p_shop_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sale record;
  v_count integer := 0;
  v_period_start date;
begin
  if not is_shop_member(p_shop_id, array['owner','manager']) then
    raise exception 'ไม่มีสิทธิ์ backfill รายการบัญชีของร้านนี้ (เฉพาะเจ้าของ/ผู้จัดการ)';
  end if;

  v_period_start := date_trunc('month', current_date)::date;

  for v_sale in
    select * from part_sales
    where shop_id = p_shop_id
      and item_status = 'completed'
      and approval_status <> 'pending_approval'
      and approval_status <> 'rejected'
      and sold_at >= v_period_start
      and not exists (select 1 from journal_entries where source_table = 'part_sales' and source_id = part_sales.sale_id)
    order by sold_at
  loop
    perform fn_post_sale_journal_entry_for_sale_id(v_sale.sale_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

-- NOTE: fn_recalc_stock_cap_status is invoked by an AFTER trigger on EVERY parts
-- INSERT/UPDATE/DELETE (fn_update_shop_stock_value) and on shops.subscription_plan changes
-- (fn_recheck_stock_cap_on_plan_change) -- both reachable via SERVICE-ROLE-initiated writes (QA
-- fixtures, CSV import, admin backend scripts) where auth.uid() is NULL (no end-user JWT sub
-- claim). A blanket is_shop_member() check breaks that legitimate path entirely -- confirmed via
-- a live Playwright regression run during this fix: an adminClient() (service-role) part insert
-- failed with "ไม่มีสิทธิ์คำนวณสถานะ stock cap ของร้านนี้" once the naive check landed. Unlike the
-- other 4 accounting functions (whose trigger chains are always tied to a real logged-in
-- end-user session), this one's chain is also reachable from pure system/service-role context.
-- Fix: only enforce the membership check when there IS a real end-user session (auth.uid() is
-- not null) -- closes the actual P0-2 concern (an arbitrary LOGGED-IN user directly RPC-calling
-- this for someone else's shop) without breaking service-role-driven recompute. anon already had
-- (pre-existing, unrelated to this migration) EXECUTE on this function with a typically-null
-- auth.uid() too -- this leaves that pre-existing low-impact gap unchanged rather than
-- introducing a new outage; the card itself rates this function "impact ต่ำ (recompute-only,
-- derived from real data, no injectable values)".
create or replace function fn_recalc_stock_cap_status(p_shop_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_value numeric;
  v_status text;
  v_grace_started timestamptz;
  v_plan text;
  p_cap numeric;
begin
  if auth.uid() is not null and not is_shop_member(p_shop_id, array['owner','manager','supervisor','technician','assistant','field_scanner','admin']) then
    raise exception 'ไม่มีสิทธิ์คำนวณสถานะ stock cap ของร้านนี้';
  end if;

  select current_stock_value, stock_cap_status, stock_cap_grace_started_at, subscription_plan
    into v_value, v_status, v_grace_started, v_plan
  from shops where shop_id = p_shop_id;

  if v_value is null then
    return;
  end if;

  p_cap := fn_tier_stock_cap(v_plan);

  if p_cap is null then
    if v_status <> 'under' then
      update shops set stock_cap_status = 'under', stock_cap_grace_started_at = null
      where shop_id = p_shop_id;
    end if;
    return;
  end if;

  if v_value <= p_cap then
    if v_status <> 'under' then
      update shops set stock_cap_status = 'under', stock_cap_grace_started_at = null
      where shop_id = p_shop_id;
    end if;
  else
    if v_status = 'under' then
      update shops set stock_cap_status = 'grace', stock_cap_grace_started_at = now()
      where shop_id = p_shop_id;
    elsif v_status = 'grace' then
      if v_grace_started is not null and now() >= v_grace_started + interval '7 days' then
        update shops set stock_cap_status = 'blocked' where shop_id = p_shop_id;
      end if;
    end if;
  end if;
end;
$function$;

create or replace function fn_seed_default_chart_of_accounts(p_shop_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not is_shop_member(p_shop_id, array['owner','manager']) then
    raise exception 'ไม่มีสิทธิ์ seed ผังบัญชีของร้านนี้ (เฉพาะเจ้าของ/ผู้จัดการ)';
  end if;

  insert into accounting_accounts (shop_id, account_code, account_name, account_type, normal_balance)
  values
    (p_shop_id, '1010100', 'เงินสด', 'asset', 'debit'),
    (p_shop_id, '1010200', 'เงินฝากธนาคาร', 'asset', 'debit'),
    (p_shop_id, '1020100', 'ลูกหนี้การค้า', 'asset', 'debit'),
    (p_shop_id, '1030100', 'สินค้าคงเหลือ-อะไหล่', 'asset', 'debit'),
    (p_shop_id, '2010100', 'เจ้าหนี้ผู้ฝากขาย', 'liability', 'credit'),
    (p_shop_id, '2050100', 'ภาษีขายรอนำส่ง (VAT Output)', 'liability', 'credit'),
    (p_shop_id, '4060100', 'รายได้จากการขายอะไหล่', 'revenue', 'credit'),
    (p_shop_id, '4070100', 'รายได้ค่าคอมมิชชั่น (ฝากขาย)', 'revenue', 'credit'),
    (p_shop_id, '5080100', 'ต้นทุนขายอะไหล่ (COGS)', 'expense', 'debit')
  on conflict (shop_id, account_code) do nothing;
end;
$function$;


-- ------------------------------------------------------------
-- P0-2 follow-up: fn_insert_system_journal_entry / fn_get_or_open_period /
-- fn_recalc_stock_cap_status all now tolerate a NULL auth.uid() (service-role
-- compatibility, see notes above each function) — which means, on its own,
-- the in-function check does nothing at all for a fully UNAUTHENTICATED
-- caller using just the public anon key (no login), since anon requests also
-- carry no JWT `sub` claim. All 3 confirmed (via pg_proc.proacl) to have an
-- explicit `anon` EXECUTE grant today — revoke it. `authenticated` keeps its
-- own separate explicit grant (confirmed independent of the PUBLIC `=X`
-- entry), so no re-grant needed there; `service_role` is untouched (its own
-- explicit grant, needed for legitimate service-role-initiated writes).
-- Verified via has_function_privilege(): anon false / authenticated true /
-- service_role true for all 3 after this.
-- ------------------------------------------------------------
revoke execute on function public.fn_insert_system_journal_entry(bigint,date,text,text,text,bigint,jsonb) from public, anon;
revoke execute on function public.fn_get_or_open_period(bigint,date) from public, anon;
revoke execute on function public.fn_recalc_stock_cap_status(bigint) from public, anon;


-- ------------------------------------------------------------
-- P1-1: revoke unnecessary EXECUTE from anon/authenticated on trigger-only
-- functions (all 7 from the card confirmed still present as-is, PLUS
-- trg_autofill_branch_id — same class of issue, shipped today by Multi-branch
-- support after the card was written, not in the card's original list but
-- caught while verifying live state)
--
-- CORRECTION vs the card's own SQL snippet: `revoke ... from anon,
-- authenticated` alone is a NO-OP here. Confirmed via pg_proc.proacl that all
-- 8 of these carry Postgres's default "EXECUTE granted to PUBLIC" (the `=X`
-- entry in the ACL) from creation time — anon/authenticated were never
-- granted individually, they were just inheriting through PUBLIC. Revoking
-- from anon/authenticated specifically leaves the PUBLIC grant (and thus
-- everyone's effective access) untouched. Must revoke FROM PUBLIC too — this
-- matches the house convention already established in
-- db/car_data_rpc_revoke_public_access_migration.sql ("REVOKE ... FROM
-- PUBLIC, anon, authenticated"). Verified via has_function_privilege() after
-- applying: anon/authenticated both false for all 8 (service_role/postgres
-- keep their own separate explicit grants, untouched by revoking PUBLIC).
-- ------------------------------------------------------------
revoke execute on function public.enforce_workflow_step_status_transition() from public, anon, authenticated;
revoke execute on function public.fn_post_sale_journal_entry() from public, anon, authenticated;
revoke execute on function public.fn_update_shop_stock_value() from public, anon, authenticated;
revoke execute on function public.fn_validate_zone_owner_entity() from public, anon, authenticated;
revoke execute on function public.guard_jobs_deleted_at() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.trg_check_branch_limit() from public, anon, authenticated;
revoke execute on function public.trg_autofill_branch_id() from public, anon, authenticated;

-- Lowest-priority item in the whole batch per the card: revoke EXECUTE from
-- anon specifically (not authenticated) for helper functions that never need
-- to be called pre-login. search_cars() already has no PUBLIC/anon grant
-- today (confirmed via pg_proc.proacl) so it's omitted here — nothing to
-- revoke.
--
-- Same PUBLIC-grant subtlety as above: is_shop_active/is_shop_member
-- currently have NO explicit `authenticated` grant at all — their
-- authenticated access comes ONLY from the PUBLIC default. Revoking PUBLIC
-- without re-granting authenticated explicitly would break is_shop_member()
-- (and therefore most RLS policies in the whole app) for logged-in users too,
-- not just anon. is_branch_member/is_branch_writable already carry their own
-- explicit `authenticated` grant independent of PUBLIC, but the re-grant
-- below is issued for all 4 regardless — harmless if already present, and
-- keeps this migration self-documenting rather than relying on that
-- pre-existing state. Verified via has_function_privilege() after applying:
-- anon false / authenticated true for all 4, and a live authenticated read
-- through RLS (which evaluates is_shop_member internally) still succeeds.
revoke execute on function public.is_branch_member(bigint, text[]) from public, anon;
revoke execute on function public.is_branch_writable(bigint) from public, anon;
revoke execute on function public.is_shop_active(bigint) from public, anon;
revoke execute on function public.is_shop_member(bigint, text[]) from public, anon;

grant execute on function public.is_branch_member(bigint, text[]) to authenticated;
grant execute on function public.is_branch_writable(bigint) to authenticated;
grant execute on function public.is_shop_active(bigint) to authenticated;
grant execute on function public.is_shop_member(bigint, text[]) to authenticated;


-- ------------------------------------------------------------
-- P1-2: function_search_path_mutable — pin search_path on all 18 functions
-- currently flagged by get_advisors (confirmed exact current signatures via
-- pg_get_function_identity_arguments before writing this; none of these are
-- overloaded). ltree stays in `public` (P2 extension move NOT done this pass
-- — see report/SOP note), so plain `public` is correct and sufficient here.
-- ------------------------------------------------------------
alter function public.zones_set_path() set search_path = public;
alter function public.zones_update_path() set search_path = public;
alter function public.update_jobs_updated_at() set search_path = public;
alter function public.update_jobs_closed_at() set search_path = public;
alter function public.generate_doc_number() set search_path = public;
alter function public.update_job_workflow_step_timestamps() set search_path = public;
alter function public.create_job_with_visibility_groups(jsonb, bigint[], uuid, text[], jsonb) set search_path = public;
alter function public.fn_shop_parts_stock_value(bigint) set search_path = public;
alter function public.fn_shop_vehicle_remaining_value(bigint) set search_path = public;
alter function public.fn_recheck_stock_cap_on_plan_change() set search_path = public;
alter function public.fn_tier_stock_cap(text) set search_path = public;
alter function public.fn_enforce_field_visibility_floor() set search_path = public;
alter function public.zones_validate_parent_shop() set search_path = public;
alter function public.fn_update_bundle_item_price_memory() set search_path = public;
alter function public.create_job_atomic(bigint, bigint, text, text, text, text, text, text, bigint, bigint, text, text, text, text[], jsonb, text, uuid, bigint[], jsonb, bigint) set search_path = public;
alter function public.fn_shop_stock_summary_totals(bigint) set search_path = public;
alter function public.fn_tier_max_branches(text) set search_path = public;
alter function public.fn_vat_rate() set search_path = public;


-- ------------------------------------------------------------
-- P2: part-photos storage bucket — disallow LIST/enumerate, keep GET-by-
-- known-key working
--
-- storage.buckets.part-photos.public = true already, and app code (lib/
-- storageHelpers.js) only ever calls .upload() + .getPublicUrl() — never
-- .list(). Supabase's /storage/v1/object/public/<bucket>/<path> endpoint
-- bypasses RLS entirely for public buckets (that's what getPublicUrl() reads
-- from), so direct fetch-by-known-URL keeps working with ZERO policy needed.
-- The only thing "Allow public read photos" (SELECT, roles={public}) was
-- actually granting on top of that is enumeration via .list()/the
-- non-public object endpoint. Dropping it removes LIST for everyone while
-- GET-by-known-URL is unaffected (confirmed: filenames are
-- timestamp+random, not guessable, and no app code path relies on listing
-- this bucket).
-- ------------------------------------------------------------
drop policy if exists "Allow public read photos" on storage.objects;


-- ------------------------------------------------------------
-- NOT done this pass (documented, not silent):
--   - ltree extension still in `public` schema. Investigated: Supabase's
--     ltree extension installs its ENTIRE operator/function library (ltree_in,
--     nlevel, subpath, text2ltree, lca, the <@/||  operators, etc. — 60+
--     objects) into `public`, not just the `ltree` type itself. zones_set_path
--     / zones_update_path (zone hierarchy path maintenance, just pinned to
--     search_path=public above) use several of these unqualified (::ltree
--     casts, <@, ||, subpath(), nlevel()). Moving the extension to the
--     `extensions` schema (which already exists and holds pgcrypto/uuid-ossp/
--     pg_stat_statements) would require re-pinning those functions'
--     search_path to `public, extensions` in the SAME migration to avoid
--     breaking zone creation/move/reparent — coupling two P1/P2 fixes
--     together in a way that raises the risk of the exact regression the
--     card explicitly warned against ("be careful not to break the zones
--     hierarchy feature"). Deferred to its own follow-up card with a proper
--     staging test pass on zone create/move/reparent before touching it.
--   - Leaked password protection toggle — Supabase Dashboard > Authentication
--     > Policies, not reachable via SQL/MCP from this environment. Product
--     owner needs to toggle this manually.
-- ============================================================
