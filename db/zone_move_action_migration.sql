-- การ์ด "ย้ายอะไหล่ระหว่าง Zone — action ใหม่ พร้อม owner_type override checkbox"
--
-- ขอบเขต (ตัดสินใจไว้แล้วในการ์ด 19 ก.ค. 2026): ย้ายชิ้นอะไหล่ทีละชิ้น "ภายในสาขาเดียวกัน" เท่านั้น
-- (ข้ามสาขาแยกเป็นการ์ด "โอนอะไหล่ข้ามสาขา" ต่างหาก — ยังไม่ทำ)
--
-- ส่วนที่ทำไปแล้วก่อนหน้านี้ (ดูหมายเหตุ "ความคืบหน้าบางส่วน 20 ก.ค. 2026" ในการ์ด — ไม่ทำซ้ำ):
-- พิมพ์ QR label โซน, สแกน QR โซนเปิดหน้า /zone/[id], bulk move ทั้งโซนที่ /move-parts,
-- ปุ่มสแกนตำแหน่งใน /add และ /edit — เหลือ 4 อย่างที่ยังไม่ทำ ทำในไฟล์นี้ + UI ที่เกี่ยวข้อง:
--  1. Action "ย้าย Zone" ทีละชิ้น จากหน้ารายการอะไหล่ (ทำใน app/move-part/[id]/page.js)
--  2. เช็ค owner_type ปลายทาง vs ปัจจุบัน + checkbox override
--  3. Toggle ระดับร้าน "บังคับสแกน QR ยืนยันตำแหน่ง" (shops.force_zone_scan_confirmation)
--  4. parts.owner_type_override — log การย้ายใช้ audit_log กลางที่มีอยู่แล้ว (trg_audit_parts จาก
--     การ์ด "ขยาย audit_log") ไม่ต้องสร้างตาราง part_zone_moves แยก ตามที่การ์ดเสนอเป็นทางเลือกไว้
--     ("ถ้าเลือกใช้ pattern เดียวกันแทนสร้างตารางเฉพาะ") — old_data/new_data ของ UPDATE บน parts
--     จะมี zone_id เก่า/ใหม่ + owner_type_override เก่า/ใหม่ + changed_by_user_id อยู่แล้วครบ

alter table shops add column if not exists force_zone_scan_confirmation boolean not null default false;
comment on column shops.force_zone_scan_confirmation is
  'บังคับให้พนักงานสแกน QR โซนยืนยันตำแหน่งจริงตอนย้าย Zone/เพิ่มอะไหล่ใหม่ แทนการเลือกจาก dropdown เฉยๆ — default ปิด ตั้งค่าได้ที่ /admin (owner/manager เท่านั้น)';

alter table parts add column if not exists owner_type_override text;
alter table parts drop constraint if exists parts_owner_type_override_check;
alter table parts add constraint parts_owner_type_override_check
  check (owner_type_override is null or owner_type_override in ('own', 'consignment', 'investor'));
comment on column parts.owner_type_override is
  'null = owner_type ตามโซนปัจจุบันเป็นค่า default ของชิ้นนี้; มีค่า = ทับค่าจากโซน (ตั้งตอนย้าย Zone แล้ว owner_type ปลายทางไม่ตรงกับของเดิม แล้วพนักงานติ๊กยืนยันว่ายังเป็นประเภทเดิม)';
