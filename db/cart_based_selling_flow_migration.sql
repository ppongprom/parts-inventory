-- ============================================================
-- Card: "Cart-based selling flow — สร้างตะกร้าก่อนขาย" (Priority: Highest, L)
--
-- ทำพร้อมกันเป็นชุดเดียวตามที่การ์ดกำหนด (คนละทำเสี่ยง checkout ที่ไม่ครบ):
--   - Cart-based selling flow (การ์ดนี้)
--   - บันทึกวิธีชำระเงินแยกทุกช่องทาง (payment_method) — มีอยู่แล้วสำหรับขายทีละชิ้นที่
--     /edit/[id] จากรอบก่อน (db/payment_method_migration.sql) — รอบนี้ใช้ซ้ำกับตะกร้า
--   - ระบบเอกสาร/ใบเสร็จแยกสำหรับขายอะไหล่ (part_sale_documents) — สร้างแบบง่ายที่สุด
--     เท่าที่การ์ดตัดสินใจไปแล้วรองรับ (ดูหมายเหตุ scope ด้านล่าง หัวข้อ 3)
--
-- ยังไม่ทำรอบนี้ (การ์ดเองมี ❓ ค้างอยู่ ที่ยังไม่ตัดสินใจ — บล็อกการเขียนจริง):
--   - doc_type='tax_invoice' (vat_type enum ยังไม่ list ในการ์ด) — รอบนี้ทำแค่ 'receipt'
--   - Pack/Ship แบบเต็มรูป (ออเดอร์จัดส่ง) — รอบนี้รองรับแค่ walk-in (ส่งมอบหน้าร้านทันที)
--     ซึ่งการ์ดเองบอกว่าเป็นทางเลือกที่ยอมรับได้แทน pack/ship (ดู flow ข้อ 8 ของการ์ด)
--   - Branch Transfer อัตโนมัติเมื่อ cross-branch (ผูกกับการ์ด "โอนอะไหล่ข้ามสาขา" แยก — Multi-branch
--     support การ์ดเองก็ยัง Not started อยู่ ยังไม่มีแนวคิด branch จริงให้ผูกกับอะไรตอนนี้)
--   - credit note / ยกเลิกเอกสาร (การ์ด part_sale_documents เองบอกว่ายังไม่ตัดสินใจว่าอยู่ scope นี้)
-- ============================================================

-- ------------------------------------------------------------
-- 1) sale_orders — header ผูกหลาย part_sales เข้าด้วยกัน (ทั้งตะกร้าเดียวกัน)
-- ------------------------------------------------------------
create table if not exists sale_orders (
  order_id       bigint generated always as identity primary key,
  shop_id        bigint not null references shops(shop_id),
  buyer_name     text,
  buyer_phone    text,
  payment_method text check (payment_method is null or payment_method in ('cash', 'bank_transfer', 'card', 'other')),
  -- pending_pick: ยืนยันขายแล้ว ตัดสต็อกแล้ว รอ pick จริง
  -- picked:       pick ครบ/บางส่วนแล้ว (ยังไม่ปิดออเดอร์ ระหว่างรอ pack/ship)
  -- completed:    ส่งมอบแล้ว (walk-in ทันที หรือจบ pack/ship)
  status         text not null default 'pending_pick' check (status in ('pending_pick', 'picked', 'completed')),
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  picked_at      timestamptz,
  completed_at   timestamptz
);

create index if not exists idx_sale_orders_shop on sale_orders (shop_id);

alter table sale_orders enable row level security;

drop policy if exists "shop members can view sale orders" on sale_orders;
create policy "shop members can view sale orders" on sale_orders
  for select using (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

-- ตรงกับมติการ์ด: "ทุก role ที่หน้างานใช้โหมดเลือกขายได้ (รวม technician/assistant) —
-- Field Scanner ไม่นับเพราะไม่เกี่ยวกับการขาย"
drop policy if exists "eligible roles can create sale orders" on sale_orders;
create policy "eligible roles can create sale orders" on sale_orders
  for insert with check (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

drop policy if exists "eligible roles can update sale orders" on sale_orders;
create policy "eligible roles can update sale orders" on sale_orders
  for update using (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']))
  with check (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

-- ------------------------------------------------------------
-- 2) part_sales: ผูกกับ order + สถานะต่อชิ้น (แต่ละชิ้นเป็นอิสระต่อกันตามมติการ์ด)
-- ------------------------------------------------------------
alter table part_sales add column if not exists order_id bigint references sale_orders(order_id);

-- 'completed' เป็น default เพื่อ backward-compat กับการขายทีละชิ้นเดิมที่ /edit/[id]
-- (ไม่ผ่านตะกร้า ไม่มี pick step — ถือว่าขาย+ส่งมอบเสร็จในขั้นตอนเดียวเหมือนเดิมทุกประการ)
alter table part_sales add column if not exists item_status text not null default 'completed'
  check (item_status in ('pending_pick', 'picked', 'not_found', 'completed'));

alter table part_sales add column if not exists not_found_note text;

create index if not exists idx_part_sales_order on part_sales (order_id);

-- 🔒 บั๊กที่แก้ (พบตอนตรวจ RLS ทั้งชุดในรอบ verification สุดท้ายของคืนนี้เอง): part_sales มี RLS
-- เปิดอยู่แล้วแต่มีแค่ policy insert/select/delete — ไม่เคยมี policy update เลยตั้งแต่ไฟล์
-- parts_sales_and_stock_deduction_migration.sql เดิม (ก่อนคืนนี้) เพราะตอนนั้นยังไม่มี flow ไหน
-- ต้อง UPDATE แถว part_sales หลัง insert เลย (ขายทีละชิ้นที่ /edit/[id] insert ครั้งเดียวจบ) — พอ
-- Cart-based selling flow เพิ่ม step "Confirm Pick" ที่ต้อง UPDATE item_status ทีหลัง (และ
-- handleMarkNotFound ที่ต้อง UPDATE เหมือนกัน) ทั้งสอง flow นี้จะโดน RLS บล็อกเงียบๆ จริงใน
-- production (0 แถวถูกแก้ ไม่มี error โยนกลับมาด้วยซ้ำ) แม้ qa-tests จะผ่านหมดเพราะ mock network
-- ทั้งชุดไม่เคยชน RLS จริง — เจอจากการรัน SQL ตรวจ policy ทั้งตารางกับ staging ตรงๆ ไม่ใช่จาก test
drop policy if exists "eligible roles can update sales" on part_sales;
create policy "eligible roles can update sales" on part_sales
  for update using (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']))
  with check (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

-- ------------------------------------------------------------
-- 3) part_sale_documents — ใบเสร็จ (receipt เท่านั้นรอบนี้ — ดูหมายเหตุ scope ด้านบน)
--    ออกตอน Confirm Pick เสร็จ (ไม่ใช่ตอนยืนยันขาย) ตามที่การ์ดตัดสินใจ
--    doc_number ใช้ generate_doc_number() ตัวเดียวกับ job_documents (รูปแบบ YYMM-<epoch ms>,
--    unique ทั่วระบบด้วย timestamp — ไม่ใช่ running number แยกต่อร้านตามที่ scenario ฉบับร่าง
--    ของการ์ด part_sale_documents เขียนไว้ตอนแรก แต่เป็น pattern เดียวกับที่ job_documents ใช้งาน
--    จริงอยู่แล้วในระบบ เลือกความสม่ำเสมอมากกว่าสร้าง scheme ใหม่อีกแบบสำหรับเอกสารประเภทเดียวกัน)
-- ------------------------------------------------------------
create table if not exists part_sale_documents (
  document_id  bigint generated always as identity primary key,
  shop_id      bigint not null references shops(shop_id),
  order_id     bigint not null references sale_orders(order_id),
  doc_type     text not null default 'receipt' check (doc_type in ('receipt')),
  doc_number   text not null unique,
  snapshot     jsonb not null, -- รายการ+ราคา+ผู้ซื้อ+payment_method ณ เวลาที่ออกเอกสาร (แช่แข็ง)
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_part_sale_documents_order on part_sale_documents (order_id);
create index if not exists idx_part_sale_documents_shop on part_sale_documents (shop_id);

alter table part_sale_documents enable row level security;

drop policy if exists "shop members can view part sale documents" on part_sale_documents;
create policy "shop members can view part sale documents" on part_sale_documents
  for select using (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

drop policy if exists "eligible roles can create part sale documents" on part_sale_documents;
create policy "eligible roles can create part sale documents" on part_sale_documents
  for insert with check (is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant']));

-- ------------------------------------------------------------
-- 4) คืนสต็อกเมื่อ pick แล้วหาไม่เจอ/ของเสียหาย (edge case ที่การ์ดกำหนด default ไว้)
--    atomic เหมือน deduct_part_stock — กันแข่งกันคืนพร้อมกัน
--
-- 🔒 บั๊กที่แก้ (พบระหว่าง cross-check integration กับ Stock Value Cap Engine คืนนี้เอง):
-- ตอนแรกฟังก์ชันนี้ไม่มีการเช็คสิทธิ์เลย ต่างจาก deduct_part_stock พี่น้องที่เช็ค auth.uid() เป็น
-- active shop_member ของร้านเจ้าของ part_id ก่อนเสมอ — เป็นช่องโหว่ multi-tenant จริง: user คนไหน
-- ก็ได้ (ไม่ว่า role อะไร ไม่ว่าอยู่ร้านไหน) เรียกฟังก์ชันนี้ด้วย part_id ของร้านอื่นแล้วเพิ่ม quantity
-- ให้ร้านนั้นได้เลยโดยไม่มีการเช็คสิทธิ์ใดๆ — เพิ่ม auth check แบบเดียวกับ deduct_part_stock แล้ว
-- ------------------------------------------------------------
create or replace function restore_part_stock(p_part_id uuid, p_quantity numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shop_id bigint;
  v_new_quantity numeric;
begin
  select shop_id into v_shop_id from parts where id = p_part_id;
  if v_shop_id is null then
    raise exception 'ไม่พบอะไหล่ชิ้นนี้';
  end if;

  if not exists (
    select 1 from shop_members
    where shop_id = v_shop_id and user_id = auth.uid() and status = 'active'
  ) then
    raise exception 'ไม่มีสิทธิ์แก้ไขสต็อกของอู่นี้';
  end if;

  update parts
  set quantity = quantity + p_quantity
  where id = p_part_id
  returning quantity into v_new_quantity;

  return v_new_quantity;
end;
$$;

grant execute on function restore_part_stock(uuid, numeric) to authenticated;

-- ------------------------------------------------------------
-- Verification queries (run manually after applying):
--   select count(*) from part_sales where item_status = 'completed' and order_id is null;
--   -- ^ should equal the pre-migration row count (all legacy single-item sales untouched)
-- ------------------------------------------------------------
