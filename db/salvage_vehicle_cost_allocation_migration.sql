-- ============================================================
-- Salvage vehicle cost allocation (relative sales value method, TAS 2/IAS 2 ย่อหน้า 14)
--
-- Card: "Salvage Vehicle Intake + Disassembly (core feature)" +
--       "Salvage vehicle cost allocation — edge cases to design for"
--
-- ก่อนหน้านี้ (db/salvage_vehicle_intake_migration.sql) ทำแค่ "Intake" ครึ่งเดียวโดยตั้งใจ —
-- ตัวไฟล์นั้นเขียนไว้ชัดเจนว่า cost allocation logic ยังทำไม่ได้เพราะการ์ดยังไม่ตัดสินใจ rounding
-- rule / freeze-หรือ-recalc / sold_whole-after-partial / เศษเหล็กบันทึกยังไง — ทั้ง 4 ข้อถูก
-- ตัดสินใจครบแล้วในการ์ดเมื่อ 21 ก.ค. 2026 (ดู "✅ ตัดสินใจแล้ว 21 ก.ค. 2026 — เคลียร์ครบ 4 ข้อที่ค้าง"
-- ในการ์ด Salvage Vehicle Intake + "✅ ตัดสินใจแล้ว 21 ก.ค. 2026 — rounding + แก้ estimate ย้อนหลัง"
-- ในการ์ด cost allocation) — ไฟล์นี้ implement ตามมติที่เคาะไว้แล้วทั้งหมด ไม่มีจุดที่ต้องเดาเอง
--
-- สรุปมติที่ implement ที่นี่:
-- 1. Rounding: ไม่มีกฎ rounding แยก — allocated_cost ของอะไหล่จริงแต่ละชิ้นคำนวณตามสัดส่วนตรงๆ
--    ตอนเพิ่มอะไหล่ (estimated_total_value freeze แล้วตั้งแต่เริ่มถอด) ส่วนเศษที่เหลือทั้งหมด (รวม
--    error สะสมจากการปัดเศษ) ตกไปที่ "เศษเหล็ก" synthetic part ตอนปิดคัน — ทำให้ Σ allocated_cost
--    ทุกแถว (รวมเศษเหล็ก) = purchase_price เป๊ะเสมอโดยอัตโนมัติ ไม่ต้องมี recalc logic ซับซ้อน
-- 2. Freeze: estimated_total_value/value_groups แก้ได้เฉพาะตอน status='in_stock' เท่านั้น
--    (ก่อนเริ่มถอดชิ้นแรก) — ถอดไปแล้วห้ามแก้ย้อนหลังเด็ดขาด (prospective)
-- 3. sold_whole ไม่อนุญาตหลังถอดไปแล้วบางชิ้น (ใช้ปุ่มขายเศษเหล็กแทน) — ไม่ implement การ block
--    ตรงนี้เพราะ UI ปัจจุบันไม่มีปุ่ม sold_whole เลย (จะเพิ่มเมื่อมีการ์ดนั้นจริง) แต่กันไว้ที่ DB
--    เป็น constraint เผื่ออนาคต
-- 4. เศษเหล็ก: บันทึกเป็น parts แถวสังเคราะห์ condition='scrap' ไหลผ่าน pipeline ปกติทุกอย่าง —
--    ผ่าน RPC (ต้องคำนวณ remainder แบบ atomic กันขายซ้ำ/race condition)
-- ============================================================

-- 1) เก็บมูลค่าประเมินต่อชิ้น (กรอกตอนถอด) — คนละคอลัมน์กับ allocated_cost (ผลลัพธ์ที่คำนวณได้)
--
-- ⚠️ พบระหว่างทดสอบ migration นี้ (22 ก.ค. 2026): `parts.allocated_cost` **ไม่เคยมีอยู่จริงในสคีมา
-- เลย** แม้จะถูกอ้างถึงในคอมเมนต์ของการ์ด/ไฟล์อื่น (เช่น Stock Value Cap Engine, การ์ดนี้เอง) ราวกับว่า
-- มีอยู่แล้ว — ตรวจสอบ information_schema.columns จริงบน staging แล้วไม่พบคอลัมน์นี้เลยสักที่ ต้อง
-- สร้างขึ้นมาใหม่ที่นี่เป็นครั้งแรกจริงๆ (ของเดิมน่าจะเป็นการเขียน spec ล่วงหน้าไว้ก่อนที่จะมีการ์ดนี้
-- มาทำจริง ไม่ใช่ implement ไปแล้วแต่ export migration ไม่ครบแบบที่เจอซ้ำๆ ในโปรเจกต์นี้)
alter table parts add column if not exists allocated_cost numeric;

comment on column parts.allocated_cost is
  'ต้นทุนที่ปันส่วนแล้วสำหรับอะไหล่ที่มาจาก salvage vehicle (คำนวณอัตโนมัติโดย trigger
   trg_allocate_salvage_part_cost) — เป็น null สำหรับอะไหล่ที่ไม่ได้มาจาก salvage vehicle
   (การ์ด Stock Value Cap Engine อ้างถึงคอลัมน์นี้ไว้ล่วงหน้าแล้วแต่ยังไม่เคยสร้างจริง)';

alter table parts add column if not exists estimated_value numeric;

comment on column parts.estimated_value is
  'มูลค่าประเมินของชิ้นนี้ตอนถอดจากซากรถ (กรอกโดย Owner/Manager/Supervisor เท่านั้น — floor เดียวกับ
   ราคาทุน) ใช้เป็นตัวหารคำนวณ allocated_cost แบบ relative sales value method — ไม่เกี่ยวกับ parts
   ที่ไม่ได้มาจาก salvage vehicle (จะเป็น null เสมอ)';

-- 2) Floor: เฉพาะ Owner/Manager/Supervisor เท่านั้นที่กรอก estimated_value ได้ (ตาม RBAC matrix
--    ที่ตัดสินใจแล้วในการ์ด — "floor เดียวกับราคาทุน") บังคับที่ DB layer เป็นด่านหลัก ไม่ใช่แค่ซ่อน
--    ช่องกรอกที่ UI (บทเรียนจาก TC-205b) — ใช้ RESTRICTIVE policy เพิ่ม (AND กับ permissive policy
--    เดิม ไม่ใช่แทนที่) จึงไม่กระทบสิทธิ์เพิ่ม/แก้อะไหล่ปกติของ role อื่นเลย
drop policy if exists "estimated_value floor on insert" on parts;
create policy "estimated_value floor on insert" on parts
  as restrictive
  for insert
  with check (
    estimated_value is null or is_shop_member(shop_id, array['owner', 'manager', 'supervisor'])
  );

drop policy if exists "estimated_value floor on update" on parts;
create policy "estimated_value floor on update" on parts
  as restrictive
  for update
  with check (
    estimated_value is null or is_shop_member(shop_id, array['owner', 'manager', 'supervisor'])
  );

-- 3) Auto-compute allocated_cost ตอนเพิ่ม/แก้ไขอะไหล่ที่ผูกกับ salvage_vehicle_id + มี estimated_value
--    สูตร: allocated_cost = purchase_price ของคัน × (estimated_value ชิ้นนี้ / estimated_total_value
--    ของคัน) — ต้องเป็น SECURITY DEFINER เพราะ role ที่เพิ่มอะไหล่ (เช่น technician) ไม่มีสิทธิ์ select
--    จาก salvage_vehicles.purchase_price ตรงๆ (floor ราคาทุน) แต่ trigger ต้องอ่านค่านั้นมาคำนวณได้
create or replace function fn_allocate_salvage_part_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_price numeric;
  v_estimated_total numeric;
begin
  -- คำนวณเฉพาะตอนผูกกับ salvage vehicle จริง และมี estimated_value ให้คิด (ไม่งั้นปล่อย
  -- allocated_cost ตามที่ผู้เรียกส่งมา หรือ null ตามเดิม — ไม่ยุ่งกับ parts ปกติที่ไม่เกี่ยวกับ salvage)
  if new.salvage_vehicle_id is null or new.estimated_value is null then
    return new;
  end if;

  -- ข้าม recalculation ถ้า estimated_value ไม่เปลี่ยนจากเดิม (กัน trigger รันซ้ำโดยไม่จำเป็นตอน
  -- update field อื่นของ part ที่ไม่เกี่ยวกับการปันส่วนต้นทุนเลย เช่น แก้ชื่อ/รูป)
  if tg_op = 'UPDATE' and old.estimated_value is not distinct from new.estimated_value
     and old.salvage_vehicle_id is not distinct from new.salvage_vehicle_id then
    return new;
  end if;

  select purchase_price, estimated_total_value into v_purchase_price, v_estimated_total
    from salvage_vehicles where vehicle_id = new.salvage_vehicle_id;

  if v_purchase_price is null or v_estimated_total is null or v_estimated_total = 0 then
    -- คันนี้ยังไม่กรอก purchase_price/estimated_total_value ให้ครบ (ไม่ควรเกิดขึ้นจริงเพราะ
    -- intake form บังคับกรอกทั้งคู่อยู่แล้ว) — ปล่อย allocated_cost เป็น null แทนหารด้วยศูนย์/error
    -- กันการเพิ่มอะไหล่พัง เพียงแค่ยังไม่คิดต้นทุนให้เท่านั้น
    new.allocated_cost := null;
    return new;
  end if;

  new.allocated_cost := round(v_purchase_price * (new.estimated_value / v_estimated_total), 2);
  return new;
end;
$$;

drop trigger if exists trg_allocate_salvage_part_cost on parts;
create trigger trg_allocate_salvage_part_cost
  before insert or update on parts
  for each row execute function fn_allocate_salvage_part_cost();

-- พบระหว่างรัน get_advisors หลัง apply migration นี้ (22 ก.ค. 2026): ฟังก์ชัน trigger นี้ (ตั้งใจให้
-- เรียกผ่าน trigger เท่านั้น ไม่ใช่ RPC ตรง) ถูก PostgREST เปิดเป็น RPC endpoint ให้ anon/authenticated
-- เรียกตรงได้โดยไม่ได้ตั้งใจ (ค่า default ของ Postgres คือ grant execute ให้ PUBLIC เสมอ ยกเว้นจะ
-- revoke เอง) — revoke ทิ้งเพราะไม่มีประโยชน์ให้เรียกตรงเลย (NEW/OLD/TG_OP ไม่มีค่านอก trigger
-- context จะ error อย่างเดียว) และลดพื้นที่โจมตีที่ไม่จำเป็นออก — ไม่กระทบการทำงานของ trigger เอง
-- เพราะ trigger invocation เกิดที่ระดับ DB engine ตรงๆ ไม่ผ่าน PostgREST/grant ชุดนี้
revoke execute on function fn_allocate_salvage_part_cost() from public, anon, authenticated;

-- 4) Freeze estimated_total_value/value_groups ตั้งแต่เริ่มถอด (status เข้า disassembling เป็นต้นไป)
--    แก้ purchase_price/chassis_number/photo_urls/notes ฯลฯ ยังทำได้ปกติ — freeze เฉพาะ 2 คอลัมน์
--    ที่ใช้เป็นตัวหารคำนวณสัดส่วนเท่านั้น (ตามมติการ์ด)
create or replace function fn_freeze_salvage_valuation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'in_stock' then
    if new.estimated_total_value is distinct from old.estimated_total_value
       or new.value_groups is distinct from old.value_groups then
      raise exception 'แก้ไขมูลค่าประเมิน (estimated_total_value/value_groups) ไม่ได้แล้ว — คันนี้เริ่มถอดไปแล้ว (status=%)', old.status;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_freeze_salvage_valuation on salvage_vehicles;
create trigger trg_freeze_salvage_valuation
  before update on salvage_vehicles
  for each row execute function fn_freeze_salvage_valuation();

-- 5) sold_whole กันไว้ล่วงหน้าที่ DB แม้ UI ยังไม่มีปุ่มนี้ (รอการ์ดแยก) — ห้าม transition เป็น
--    sold_whole ถ้ามีอะไหล่ถูกถอดออกจากคันนี้ไปแล้วอย่างน้อย 1 ชิ้น (ตามมติ: "sold_whole ใช้ได้
--    เฉพาะจาก status in_stock เท่านั้น")
create or replace function fn_guard_sold_whole_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_part_count int;
begin
  if new.status = 'sold_whole' and old.status <> 'in_stock' then
    raise exception 'sold_whole ใช้ได้เฉพาะตอนยังไม่ถอดอะไหล่เลย (status=in_stock) — คันนี้สถานะปัจจุบันคือ % ใช้ปุ่ม "ขายซากที่เหลือ" แทน', old.status;
  end if;

  if new.status = 'sold_whole' then
    select count(*) into v_part_count from parts where salvage_vehicle_id = new.vehicle_id;
    if v_part_count > 0 then
      raise exception 'sold_whole ใช้ไม่ได้ — มีอะไหล่ถูกถอดจากคันนี้ไปแล้ว % ชิ้น ใช้ปุ่ม "ขายซากที่เหลือ" แทน', v_part_count;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_sold_whole_transition on salvage_vehicles;
create trigger trg_guard_sold_whole_transition
  before update on salvage_vehicles
  for each row execute function fn_guard_sold_whole_transition();

-- 6) RBAC matrix ที่ตัดสินใจแล้วในการ์ด — เข้มกว่า RLS เดิมใน salvage_vehicle_intake_migration.sql
--    (ไฟล์เดิม insert/update อนุญาต technician ด้วยเพราะตอนเขียนไฟล์นั้น RBAC ยังไม่ตัดสินใจ ใช้
--    pattern ของ jobs ไปพลางก่อนตามที่ comment ในไฟล์ระบุไว้ตรงๆ) — มติจริง: สร้าง/แก้ vehicle
--    (purchase_price/estimated_total_value) และปิดคัน/ขายเศษเหล็ก เป็น Owner/Manager/Supervisor
--    เท่านั้น — technician "เพิ่มอะไหล่จากคัน" ยังทำได้ปกติเพราะนั่นคือ insert บนตาราง parts
--    (คนละ policy คนละตาราง ไม่ถูกกระทบ)
drop policy if exists "eligible roles can insert salvage vehicles" on salvage_vehicles;
create policy "eligible roles can insert salvage vehicles" on salvage_vehicles
  for insert with check (
    is_shop_member(shop_id, array['owner', 'manager', 'supervisor'])
  );

drop policy if exists "eligible roles can update salvage vehicles" on salvage_vehicles;
create policy "eligible roles can update salvage vehicles" on salvage_vehicles
  for update using (
    is_shop_member(shop_id, array['owner', 'manager', 'supervisor'])
  );

-- 7) RPC ขายซากที่เหลือเป็นเศษเหล็ก — สร้าง part สังเคราะห์รับ allocated_cost ส่วนที่เหลือทั้งหมด
--    (purchase_price - Σ allocated_cost ของอะไหล่จริงที่ถอดไปแล้ว) แล้วไหลผ่าน cart/checkout/
--    part_sale_documents/payment_method เหมือน part ปกติทุกอย่างตามมติการ์ด — ทำเป็น RPC (ไม่ใช่
--    insert ตรงจาก client) เพื่อให้ atomic กันเรียกซ้ำ/race condition และเช็คสิทธิ์จริงจาก auth.uid()
--    (client เรียกผ่าน publishable key ตรงๆ ไม่ใช่ service_role — auth.uid() ใช้งานได้ถูกต้อง
--    ต่างจากกรณี platform_* ที่เรียกผ่าน server ด้วย service_role)
create or replace function sell_salvage_vehicle_scrap(p_vehicle_id bigint)
returns parts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vehicle salvage_vehicles;
  v_caller_role text;
  v_allocated_so_far numeric;
  v_remainder numeric;
  v_new_part parts;
begin
  select * into v_vehicle from salvage_vehicles where vehicle_id = p_vehicle_id for update;
  if v_vehicle is null then
    raise exception 'ไม่พบซากรถ vehicle_id=%', p_vehicle_id;
  end if;

  select role into v_caller_role from shop_members
    where shop_id = v_vehicle.shop_id and user_id = auth.uid() and status = 'active'
    limit 1;
  if v_caller_role is null or v_caller_role not in ('owner', 'manager', 'supervisor') then
    raise exception 'ไม่มีสิทธิ์ขายซากที่เหลือของคันนี้';
  end if;

  if v_vehicle.status in ('fully_disassembled', 'sold_whole') then
    raise exception 'คันนี้ปิดไปแล้ว (status=%) — ขายเศษเหล็กซ้ำไม่ได้', v_vehicle.status;
  end if;

  if v_vehicle.purchase_price is null then
    raise exception 'คันนี้ไม่มี purchase_price บันทึกไว้ — คำนวณเศษเหล็กไม่ได้';
  end if;

  select coalesce(sum(allocated_cost), 0) into v_allocated_so_far
    from parts where salvage_vehicle_id = p_vehicle_id;

  v_remainder := v_vehicle.purchase_price - v_allocated_so_far;
  -- ไม่ควรติดลบในทางปฏิบัติ (Σ allocated_cost ของอะไหล่จริงต้อง <= purchase_price เสมอเพราะคำนวณ
  -- จากสัดส่วน estimated_value/estimated_total_value ที่ผลรวม <= 1) แต่กันไว้เผื่อ floating point
  -- edge case เล็กน้อย ไม่ให้ remainder ติดลบหลุดออกไป
  if v_remainder < 0 then
    v_remainder := 0;
  end if;

  insert into parts (
    shop_id, part_name, car_brand, car_model, generation_id, trim_id,
    condition, source_type, status, quantity, price, item_type,
    zone_id, salvage_vehicle_id, allocated_cost, notes
  )
  select
    v_vehicle.shop_id,
    'เศษเหล็ก — ซากรถ #' || v_vehicle.vehicle_id,
    null, null, v_vehicle.generation_id, v_vehicle.trim_id,
    'scrap', 'salvage', 'available', 1, null, 'salvage',
    v_vehicle.zone_id, p_vehicle_id, v_remainder,
    'สร้างอัตโนมัติตอนขายซากที่เหลือ (sell_salvage_vehicle_scrap) — allocated_cost = purchase_price - Σ allocated_cost ของอะไหล่จริงที่ถอดไปแล้ว'
  returning * into v_new_part;

  update salvage_vehicles set status = 'fully_disassembled' where vehicle_id = p_vehicle_id;

  return v_new_part;
end;
$$;

revoke execute on function sell_salvage_vehicle_scrap(bigint) from public, anon;
grant execute on function sell_salvage_vehicle_scrap(bigint) to authenticated;
