-- ============================================================
-- Migration: รวมผลค้นหารถให้ครอบคลุมทั้งระดับ generation และ trim ในคิวรีเดียว
-- ให้กล่องค้นหาเดียว (CarAutocomplete) เลือกรุ่นย่อยได้ตรงๆ โดยไม่ต้องมี
-- dropdown แยกอีกขั้น
--
-- แต่ละ generation จะมีทั้ง:
--  - แถว "ทั่วไป" (ไม่ระบุ trim) เสมอ 1 แถว — สำหรับกรณีไม่รู้ว่า trim ไหน
--  - แถว "เจาะจง trim" อีกหลายแถวถ้า generation นั้นมี trim อยู่ในฐานข้อมูล
-- ============================================================

create or replace view car_search_display as
select
  g.generation_id,
  null::bigint as trim_id,
  b.brand_name,
  m.model_name,
  g.generation_code,
  gd.year_range_display,
  g.vehicle_type,
  null::text as trim_name,
  null::text as powertrain_type
from model_generations g
join models m on m.model_id = g.model_id
join brands b on b.brand_id = m.brand_id
join model_generations_display gd on gd.generation_id = g.generation_id

union all

select
  g.generation_id,
  t.trim_id,
  b.brand_name,
  m.model_name,
  g.generation_code,
  gd.year_range_display,
  g.vehicle_type,
  t.trim_name,
  t.powertrain_type
from model_trims t
join model_generations g on g.generation_id = t.generation_id
join models m on m.model_id = g.model_id
join brands b on b.brand_id = m.brand_id
join model_generations_display gd on gd.generation_id = g.generation_id;
