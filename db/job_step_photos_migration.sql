-- ============================================================
-- job_step_photos — รูปหลักฐานต่อขั้นตอนงาน (job_workflow_steps)
--
-- การ์ด: "แต่ละขั้นตอนของงานควรเก็บรูปเพิ่ม เพื่อให้ลูกค้าติดตามสถานะการซ่อม/เห็นภาพก่อน-หลัง
-- เปลี่ยน เป็นหลักฐานให้ลูกค้ามั่นใจ" — จัดกลุ่มภาพเป็น 3 หมวดต่อ 1 ขั้นตอนงาน:
--   general = สภาพทั่วไป, before = สภาพก่อนเปลี่ยน/แก้ไข, after = สภาพหลังเปลี่ยน/แก้ไข
--
-- คนละเรื่องกับ jobs.photo_urls (รูปตอนรับรถเข้า ก่อนแตกงานเป็นขั้นตอนย่อยเลย) — ตารางนี้ผูก
-- กับ step_id เฉพาะ ไม่ใช่ job โดยรวม
-- ============================================================

create table if not exists job_step_photos (
  photo_id      bigint generated always as identity primary key,
  step_id       bigint not null references job_workflow_steps(step_id) on delete cascade,
  job_id        bigint not null references jobs(job_id) on delete cascade,
  shop_id       bigint not null references shops(shop_id),
  category      text not null check (category in ('general', 'before', 'after')),
  photo_url     text not null,
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create index if not exists idx_job_step_photos_step on job_step_photos (step_id);
create index if not exists idx_job_step_photos_job on job_step_photos (job_id);

alter table job_step_photos enable row level security;

-- เงื่อนไขเดียวกับ job_workflow_steps ทุกประการ (ตั้งใจ — ใครดู/แก้ไขขั้นตอนงานได้ ก็ควร
-- ดู/แนบรูปหลักฐานของขั้นตอนนั้นได้เหมือนกัน ไม่มีเหตุผลให้สิทธิ์ต่างกัน)
drop policy if exists "shop members can view step photos" on job_step_photos;
create policy "shop members can view step photos" on job_step_photos
  for select using (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant'])
    and exists (
      select 1 from jobs j
      where j.job_id = job_step_photos.job_id and can_view_job(j.job_id, j.shop_id)
    )
  );

drop policy if exists "eligible roles can manage step photos" on job_step_photos;
create policy "eligible roles can manage step photos" on job_step_photos
  for all using (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant'])
  )
  with check (
    is_shop_member(shop_id, array['owner','manager','supervisor','technician','assistant'])
  );
