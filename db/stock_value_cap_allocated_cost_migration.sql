-- ============================================================
-- Card: "Stock Value Cap Engine" — incorporate allocated_cost now that it exists
--
-- db/stock_value_cap_engine_migration.sql explicitly said its cost formula only used
-- price × quantity because "รอ Salvage cost allocation ก่อนถึงจะรวม allocated_cost ได้"
-- (waiting on the Salvage cost allocation card before allocated_cost could be included) —
-- SOP.md's section 6 note repeats the same thing. That card shipped tonight
-- (db/salvage_vehicle_cost_allocation_migration.sql), so this dependency is now unblocked.
--
-- Formula change: a part's contribution to shops.current_stock_value now prefers
-- allocated_cost (the real cost basis for a salvage-derived part) over price (just the asking/
-- sale price, which is a much rougher proxy and can be zero/unset or marked up well above cost)
-- when allocated_cost is present; falls back to price for everything else (unchanged behavior
-- for non-salvage parts, which never have allocated_cost).
-- ============================================================

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
    v_old_value := coalesce(old.allocated_cost, old.price, 0) * coalesce(old.quantity, 0) * (case when old.is_active then 1 else 0 end);
    v_new_value := 0;
  elsif tg_op = 'INSERT' then
    v_shop_id := new.shop_id;
    v_old_value := 0;
    v_new_value := coalesce(new.allocated_cost, new.price, 0) * coalesce(new.quantity, 0) * (case when new.is_active then 1 else 0 end);
  else -- UPDATE
    v_shop_id := new.shop_id;
    v_old_value := coalesce(old.allocated_cost, old.price, 0) * coalesce(old.quantity, 0) * (case when old.is_active then 1 else 0 end);
    v_new_value := coalesce(new.allocated_cost, new.price, 0) * coalesce(new.quantity, 0) * (case when new.is_active then 1 else 0 end);
  end if;

  if v_shop_id is not null and v_new_value <> v_old_value then
    update shops set current_stock_value = current_stock_value + (v_new_value - v_old_value)
    where shop_id = v_shop_id;
    perform fn_recalc_stock_cap_status(v_shop_id);
  end if;

  return null; -- AFTER trigger — return value ignored by Postgres, matches original convention
end;
$$;

-- Recompute current_stock_value for every shop from scratch with the new formula (not just
-- zero-value shops like the original backfill's idempotent guard did - the formula itself
-- changed, so every shop's running counter needs a fresh recompute, not just shops that never
-- got backfilled)
update shops s
set current_stock_value = coalesce((
  select sum(coalesce(p.allocated_cost, p.price, 0) * coalesce(p.quantity, 0))
  from parts p
  where p.shop_id = s.shop_id and p.is_active = true
), 0);

-- Re-run the state machine for every shop in case the recompute pushed anyone across a cap
-- boundary (matches the same reasoning as fn_recalc_stock_cap_status being called after every
-- live trigger-driven update - this backfill needs the same follow-up)
do $$
declare
  v_shop record;
begin
  for v_shop in select shop_id from shops loop
    perform fn_recalc_stock_cap_status(v_shop.shop_id);
  end loop;
end $$;
