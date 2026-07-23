-- ============================================================
-- ผูก "รายการในเซต" (job_type_bundle_items) ที่ไม่มี sub-variant กับ SKU สต็อกจริงได้ (ไม่บังคับ)
-- เดิมมีแค่ job_type_bundle_item_variants.part_id เท่านั้น — รายการที่ไม่มี sub-variant เลย
-- (กรณีทั่วไปส่วนใหญ่) ไม่มีที่เก็บ part_id ให้ตอนนี้เพิ่มคอลัมน์เดียวกันเข้าไปที่ตาราง items ด้วย
-- ใช้คู่กับ JobTypeBundleConfirmModal.js ที่เพิ่มช่องค้นหาจากสต็อกให้ทั้งระดับรายการและ sub-variant
-- ============================================================

alter table job_type_bundle_items
  add column if not exists part_id uuid references parts(id);
