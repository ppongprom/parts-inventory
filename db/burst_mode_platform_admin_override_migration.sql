-- ============================================================
-- Card: "Onboarding Burst Mode — Requester/Approver workflow"
--
-- ✅ มติ 21 ก.ค. 2026 (เคลียร์ 1 ใน 4 ข้อที่ค้าง — "Owner ไม่ตอบจนหมดเขต"):
-- Platform Admin กดต่อแทน Owner ได้ ถ้า Owner ไม่ตอบคำขอต่ออายุ Burst Mode จนหมดเขต — ใช้สิทธิ์
-- "ต่อได้ 1 รอบ" เดียวกับที่ Owner มี ไม่ใช่สิทธิ์เพิ่มพิเศษ ต้องลง platform_audit_log ระบุชัดว่า
-- admin เป็นผู้กดแทน (ดู app/api/team/burst-mode-extension/route.js — action "respond" ยอมรับทั้ง
-- Owner ของอู่นั้นเองหรือ Platform Admin super_admin/support)
--
-- platform_audit_log.action มี CHECK constraint จำกัด action ที่รับได้ (พบบั๊กเดียวกันมาก่อนแล้ว
-- ในการ์ด P0 security — 4 ใน 5 ฟังก์ชัน platform_* insert action ไม่ตรงกับ constraint นี้เลย จนกว่า
-- จะแก้ในเซสชันนี้) — เพิ่ม 'burst_mode_extension_override' เป็นค่าที่อนุญาตใหม่ กันบั๊กแบบเดียวกัน
-- เกิดซ้ำกับ action ใหม่นี้ตั้งแต่ต้น
-- ============================================================

alter table platform_audit_log drop constraint if exists platform_audit_log_action_check;
alter table platform_audit_log add constraint platform_audit_log_action_check
  check (action in (
    'subscription_edit',
    'join_as_support',
    'admin_added',
    'admin_removed',
    'admin_role_changed',
    'burst_mode_extension_override'
  ));
