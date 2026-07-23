-- ============================================================
-- Bug fix: car_search_display view ไม่เคย grant SELECT ให้ role authenticated/anon เลย
-- (มีแค่ service_role/postgres) — ทำให้ CarAutocomplete ค้นหารถไม่เจอทุกยี่ห้อ ไม่ใช่แค่ BMW
-- (ยืนยันแล้วด้วยการจำลอง role authenticated ยิง query ตรง: permission denied for view
-- car_search_display)
--
-- แก้ด้วย SECURITY DEFINER RPC แทนการ grant ตรงบน view (ตามที่ผู้ใช้ขอ — ไม่ต้องการเปิดให้
-- authenticated/anon อ่าน view ตรงๆ เพราะโดน Supabase Security Advisor แจ้งเตือนเรื่องนี้) —
-- pattern เดียวกับ search_cost_item_history() ใน db/job_cost_item_history_search_migration.sql:
-- view ยังคงล็อกอยู่เหมือนเดิมทุกประการ ฟังก์ชันนี้ (เจ้าของเป็น postgres/service role) อ่านผ่านได้
-- โดยไม่ต้อง grant เพิ่ม เปิดให้แค่ authenticated เรียกฟังก์ชันนี้เท่านั้น
--
-- Token-matching logic เหมือนเดิมทุกประการกับที่ CarAutocomplete.js เคยทำฝั่ง client (แต่ละ token
-- ต้อง match อย่างน้อย 1 คอลัมน์จาก brand/model/generation_code/trim — token ตัวเลขล้วนสั้นๆ
-- 1-3 หลักไม่ match generation_code กันชนกับปีของรุ่นอื่นโดยบังเอิญ) — เขียนแบบ pure SQL
-- (NOT EXISTS token ที่ไม่ match เลย) แทน dynamic SQL เพื่อความปลอดภัย/อ่านง่าย
-- ============================================================

create or replace function search_cars(p_query text)
returns setof car_search_display
language sql
security definer
set search_path = public
stable
as $$
  select cs.*
  from car_search_display cs
  where not exists (
    select 1
    from unnest(regexp_split_to_array(trim(coalesce(p_query, '')), '\s+')) as tok(token)
    where tok.token <> ''
      and not (
        (tok.token ~ '^\d{1,3}$' and (
          cs.brand_name ilike '%' || tok.token || '%'
          or cs.model_name ilike '%' || tok.token || '%'
          or cs.trim_name ilike '%' || tok.token || '%'
        ))
        or
        (tok.token !~ '^\d{1,3}$' and (
          cs.brand_name ilike '%' || tok.token || '%'
          or cs.model_name ilike '%' || tok.token || '%'
          or cs.generation_code ilike '%' || tok.token || '%'
          or cs.trim_name ilike '%' || tok.token || '%'
        ))
      )
  )
  order by cs.brand_name, cs.model_name, cs.generation_id, cs.trim_id nulls first
  limit 15;
$$;

-- revoke จาก public/anon ชัดเจน (Postgres grant EXECUTE ให้ PUBLIC เป็นค่าเริ่มต้นเสมอตอนสร้าง
-- ฟังก์ชันใหม่ ถ้าไม่ revoke จะโดน Supabase Security Advisor เตือน "anon executable" — ต่างจาก
-- search_cost_item_history()/RPC อื่นๆ ในโปรเจกต์นี้ที่ยังไม่เคย revoke ส่วนนั้น (ของเดิมมี warning
-- เดียวกันค้างอยู่แล้ว ไม่ใช่ปัญหาใหม่ แต่ฟังก์ชันใหม่นี้ตั้งใจทำให้เรียบร้อยกว่าตั้งแต่แรก)
revoke execute on function search_cars(text) from public, anon;
grant execute on function search_cars(text) to authenticated;

-- ------------------------------------------------------------
-- Verification query (run manually after applying):
--   set local role authenticated;
--   select * from search_cars('bmw');   -- ควรได้ 13 แถว ไม่ error
--   select * from search_cars('toyota camry');
--   reset role;
-- ------------------------------------------------------------
