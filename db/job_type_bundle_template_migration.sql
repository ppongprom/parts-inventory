-- ============================================================
-- Card: "Feature: เซตอะไหล่+ค่าแรงตามประเภทงาน (Job Type Bundle Template)" (23 ก.ค. 2026)
--
-- พิมพ์ชื่อประเภทงาน -> ระบบดึงเซตอะไหล่+ค่าแรงที่เกี่ยวข้องมาให้อัตโนมัติ พร้อมราคาล่าสุด
-- (price memory แยก logic ค่าแรง/ค่าอะไหล่) รองรับ sub-variant ในรายการเดียวกัน (เช่น น้ำมันเกียร์
-- CVT vs WS) ผูกกับ Field Visibility Whitelist pattern เดิม — Owner/Manager/Admin จัดการเซตได้,
-- Technician ค้นหา/นำไปใช้ได้อย่างเดียว (ตัดสินใจแล้ว 23 ก.ค. 2026)
--
-- ไม่มี job_type field ในระบบเดิมเลย (ยืนยันด้วย grep) — แนวคิด "ประเภทงาน" ในการ์ดนี้เป็นของใหม่
-- ทั้งหมด ผูกกับ job_type_bundle_templates.job_type_name (free text ต่อร้าน ไม่ใช่ enum กลาง)
-- ============================================================

create table if not exists job_type_bundle_templates (
  template_id   bigint generated always as identity primary key,
  shop_id       bigint not null references shops(shop_id) on delete cascade,
  job_type_name text not null,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
-- unique case-insensitive ต่อร้าน กัน "ยกเครื่อง" กับ "ยกเครื่อง " (เว้นวรรคท้าย) ซ้ำกันเงียบๆ
create unique index if not exists idx_job_type_bundle_templates_shop_name
  on job_type_bundle_templates (shop_id, lower(trim(job_type_name)));

create table if not exists job_type_bundle_items (
  item_id           bigint generated always as identity primary key,
  template_id       bigint not null references job_type_bundle_templates(template_id) on delete cascade,
  category          text not null check (category in ('labor','parts','other')), -- ตรงกับ job_cost_items.category
  item_group_label  text not null,   -- เช่น "น้ำมันเกียร์" — ชื่อรายการก่อนเลือก sub-variant
  description       text not null,   -- ข้อความ default variant เช่น "น้ำมันเครื่อง 5W-30"
  default_amount    numeric,         -- ราคาล่าสุด — null ได้สำหรับค่าแรง (ไม่ auto-lock ตามการ์ด)
  default_quantity  numeric not null default 1, -- ปริมาณเริ่มต้นตอนใส่เข้างาน (เช่น น้ำมันเครื่อง 4 ลิตร)
  is_price_locked   boolean not null default false, -- true = ค่าอะไหล่ (จำราคา), false = ค่าแรง
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now()
);
create index if not exists idx_job_type_bundle_items_template on job_type_bundle_items (template_id);

-- รองรับ sub-variant ในรายการเดียวกัน (requirement #4: น้ำมันเกียร์ CVT vs WS คนละ SKU)
create table if not exists job_type_bundle_item_variants (
  variant_id       bigint generated always as identity primary key,
  item_id          bigint not null references job_type_bundle_items(item_id) on delete cascade,
  variant_label    text not null,     -- "เกียร์ CVT" / "เกียร์ WS"
  description      text not null,     -- ข้อความที่จะเขียนลง job_cost_items.description ตอนนำไปใช้
  default_amount   numeric,
  default_quantity numeric not null default 1,
  part_id          uuid references parts(id), -- ผูกกับ SKU สต็อกจริงได้ (ไม่บังคับ)
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists idx_job_type_bundle_item_variants_item on job_type_bundle_item_variants (item_id);

-- Price-memory linkage: แถว job_cost_items ที่มาจากเซต ผูก id ของ item/variant ต้นทางไว้ เพื่อให้
-- trigger เขียนราคากลับไปที่เซตได้ (เฉพาะค่าอะไหล่ — requirement #2 split logic)
alter table job_cost_items add column if not exists bundle_item_id bigint references job_type_bundle_items(item_id);
alter table job_cost_items add column if not exists bundle_variant_id bigint references job_type_bundle_item_variants(variant_id);

create or replace function fn_update_bundle_item_price_memory()
returns trigger
language plpgsql
as $$
begin
  -- ค่าแรงไม่ auto-lock เด็ดขาด (requirement #2) — กันไว้แม้เผลอผูก bundle_item_id มาด้วย
  if new.category = 'labor' then
    return new;
  end if;
  if new.bundle_variant_id is not null then
    update job_type_bundle_item_variants set default_amount = new.amount / greatest(new.quantity, 1)
      where variant_id = new.bundle_variant_id;
  elsif new.bundle_item_id is not null then
    update job_type_bundle_items set default_amount = new.amount / greatest(new.quantity, 1)
      where item_id = new.bundle_item_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_update_bundle_item_price_memory on job_cost_items;
create trigger trg_update_bundle_item_price_memory
  after insert or update of amount, quantity on job_cost_items
  for each row execute function fn_update_bundle_item_price_memory();

alter table job_type_bundle_templates enable row level security;
alter table job_type_bundle_items enable row level security;
alter table job_type_bundle_item_variants enable row level security;

-- อ่าน: ทุก role ที่ "นำเซตไปใช้กับงาน" ได้ (รวม technician ตามตารางสิทธิ์ในการ์ด)
drop policy if exists "shop members can view job type bundles" on job_type_bundle_templates;
create policy "shop members can view job type bundles" on job_type_bundle_templates
  for select using (is_shop_member(shop_id, array['owner','manager','admin','supervisor','technician','assistant']));

-- จัดการ (สร้าง/แก้/ลบ): Owner/Manager/Admin เท่านั้น (ตารางสิทธิ์ในการ์ด)
drop policy if exists "owner/manager/admin can manage job type bundles" on job_type_bundle_templates;
create policy "owner/manager/admin can manage job type bundles" on job_type_bundle_templates
  for all using (is_shop_member(shop_id, array['owner','manager','admin']))
  with check (is_shop_member(shop_id, array['owner','manager','admin']));

drop policy if exists "shop members can view job type bundle items" on job_type_bundle_items;
create policy "shop members can view job type bundle items" on job_type_bundle_items
  for select using (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_items.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin','supervisor','technician','assistant'])
  ));

drop policy if exists "owner/manager/admin can manage job type bundle items" on job_type_bundle_items;
create policy "owner/manager/admin can manage job type bundle items" on job_type_bundle_items
  for all using (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_items.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ))
  with check (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_items.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ));

drop policy if exists "shop members can view job type bundle item variants" on job_type_bundle_item_variants;
create policy "shop members can view job type bundle item variants" on job_type_bundle_item_variants
  for select using (exists (
    select 1 from job_type_bundle_items i
    join job_type_bundle_templates t on t.template_id = i.template_id
    where i.item_id = job_type_bundle_item_variants.item_id
      and is_shop_member(t.shop_id, array['owner','manager','admin','supervisor','technician','assistant'])
  ));

drop policy if exists "owner/manager/admin can manage job type bundle item variants" on job_type_bundle_item_variants;
create policy "owner/manager/admin can manage job type bundle item variants" on job_type_bundle_item_variants
  for all using (exists (
    select 1 from job_type_bundle_items i
    join job_type_bundle_templates t on t.template_id = i.template_id
    where i.item_id = job_type_bundle_item_variants.item_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ))
  with check (exists (
    select 1 from job_type_bundle_items i
    join job_type_bundle_templates t on t.template_id = i.template_id
    where i.item_id = job_type_bundle_item_variants.item_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ));

-- ------------------------------------------------------------
-- Verification query (run manually after applying):
--   select * from pg_policies where tablename like 'job_type_bundle%';
--   select column_name from information_schema.columns where table_name = 'job_cost_items'
--     and column_name in ('bundle_item_id','bundle_variant_id');
-- ------------------------------------------------------------
