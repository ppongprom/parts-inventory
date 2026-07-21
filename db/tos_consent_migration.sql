-- การ์ด "กลไก ToS consent — สัญญาใช้บริการ + บันทึกการยอมรับ (blocker #2 ของ Accounting)"
--
-- ขอบเขต (การ์ดแบ่งไว้เอง): "โค้ด S–M + งานเอกสาร/กฎหมาย" — ไฟล์นี้ทำเฉพาะฝั่งโค้ด/กลไกบันทึก
-- การยอมรับ ส่วนเนื้อหาสัญญาจริง (ต้องให้ทนาย/ผู้รู้กฎหมายตรวจก่อนใช้งานจริงตามที่การ์ดระบุ) อยู่ใน
-- config/tosContent.js เป็น "ร่าง" ชัดเจน — ยังไม่ใช่สัญญาที่ผ่าน legal review

create table if not exists shop_tos_acceptances (
  id           bigint generated always as identity primary key,
  shop_id      bigint not null references shops(shop_id),
  user_id      uuid not null references auth.users(id),
  tos_version  text not null,
  accepted_at  timestamptz not null default now(),
  ip           inet
);

create index if not exists idx_shop_tos_acceptances_shop on shop_tos_acceptances (shop_id, accepted_at desc);

alter table shop_tos_acceptances enable row level security;

-- ทุก role ในร้านต้องอ่านได้ (ไม่ใช่แค่ owner/manager) เพราะทุกคนต้องเช็คได้ว่าร้านยอมรับหรือยัง
-- ถึงจะรู้ว่าต้องรอ owner หรือใช้งานต่อได้เลย — append-only โดยไม่มี insert/update/delete policy
-- ให้ authenticated/anon (เขียนได้เฉพาะผ่าน RPC accept_shop_tos ที่เป็น SECURITY DEFINER เท่านั้น)
drop policy if exists "shop members can view own shop tos acceptances" on shop_tos_acceptances;
create policy "shop members can view own shop tos acceptances" on shop_tos_acceptances
  for select using (
    is_shop_member(shop_id, array['owner', 'manager', 'supervisor', 'technician', 'assistant'])
  );

-- ✅ ตัดสินใจแล้วในการ์ด: คนที่กดยอมรับต้องเป็น owner เท่านั้น (role อื่น → error ชัดเจน)
-- บันทึก version+timestamp+user ครบ, ip ใส่ null ได้ (ไม่มี request header ให้ดึงจาก DB layer
-- ตรงๆ ในกรณีเรียกผ่าน RPC ธรรมดา — เว้นไว้ให้ชั้น API route เติมทีหลังได้ถ้าต้องการ)
create or replace function accept_shop_tos(p_shop_id bigint, p_version text, p_ip inet default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from shop_members
    where shop_id = p_shop_id and user_id = auth.uid() and status = 'active'
    limit 1;

  if v_role is null then
    raise exception 'ไม่ใช่สมาชิกร้านนี้';
  end if;

  if v_role <> 'owner' then
    raise exception 'เฉพาะเจ้าของร้านเท่านั้นที่ยอมรับเงื่อนไขได้ — กรุณาติดต่อเจ้าของร้าน';
  end if;

  insert into shop_tos_acceptances (shop_id, user_id, tos_version, ip)
  values (p_shop_id, auth.uid(), p_version, p_ip);
end;
$$;

-- ยังไม่ตัดสินใจ (ทิ้งไว้ตามการ์ด — ไม่ implement รอบนี้):
--  - Trial -> Paid ระหว่างรอบ: ผลต่อ ToS เวอร์ชันไหม (ไม่เกี่ยวกันโดยตรง แต่การ์ดค้างคำถามนี้ไว้ที่
--    การ์ด Onboarding Burst Mode ไม่ใช่การ์ดนี้)
--  - หน้า /admin UI สำหรับให้ owner เห็นปุ่มยืนยันรับทราบเวอร์ชันใหม่แบบ manual (นอกจาก gate อัตโนมัติ)
