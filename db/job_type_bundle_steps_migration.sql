-- ============================================================
-- Job Type Bundle Template — เพิ่ม preset "ขั้นตอนการทำงาน" (23 ก.ค. 2026)
--
-- เดิมเซตงานมีแค่ "รายการค่าใช้จ่าย" (job_type_bundle_items) — ตอนนี้เพิ่มให้ผูกกับชุดขั้นตอน
-- การทำงาน (job_workflow_steps) ได้ด้วย ตัดสินใจแล้วว่า preset เก็บแค่ชื่อ+ลำดับขั้นตอน
-- ไม่มีคอลัมน์ assigned_to เลย — ตอน apply เข้างานจริงจะ insert เป็น assigned_to = null เสมอ
-- ไม่ผูกคนรับผิดชอบมาจากเซต ต้องมากดมอบหมายเองทีหลังตามปกติ
-- ============================================================

create table if not exists job_type_bundle_steps (
  step_id      bigint generated always as identity primary key,
  template_id  bigint not null references job_type_bundle_templates(template_id) on delete cascade,
  step_name    text not null,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_job_type_bundle_steps_template on job_type_bundle_steps (template_id);

alter table job_type_bundle_steps enable row level security;

drop policy if exists "shop members can view job type bundle steps" on job_type_bundle_steps;
create policy "shop members can view job type bundle steps" on job_type_bundle_steps
  for select using (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_steps.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin','supervisor','technician','assistant'])
  ));

drop policy if exists "owner/manager/admin can manage job type bundle steps" on job_type_bundle_steps;
create policy "owner/manager/admin can manage job type bundle steps" on job_type_bundle_steps
  for all using (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_steps.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ))
  with check (exists (
    select 1 from job_type_bundle_templates t where t.template_id = job_type_bundle_steps.template_id
      and is_shop_member(t.shop_id, array['owner','manager','admin'])
  ));

-- ------------------------------------------------------------
-- Verification query (run manually after applying):
--   select * from pg_policies where tablename = 'job_type_bundle_steps';
-- ------------------------------------------------------------
