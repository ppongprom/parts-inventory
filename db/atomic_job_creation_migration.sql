-- Fix JOB-202/203 (QA Defect Triage 17 ก.ค. 2569, ยังไม่แก้ ณ 23 ก.ค. 2569):
-- เดิม app/jobs/new/page.js insert jobs -> job_visibility_groups -> job_workflow_steps
-- แยก 3 คำสั่งอิสระจากกัน ถ้า insert แรกสำเร็จแต่คำสั่งถัดไป fail (network, RLS, validation)
-- จะได้ job ที่ "เห็นได้ทุกคนในอู่ทันที" ค้างอยู่ในระบบ (ไม่มีแถวใน job_visibility_groups)
-- ทั้งที่ผู้ใช้ตั้งใจจำกัดกลุ่ม และถ้ากด submit ซ้ำหลัง error จะได้ job ซ้ำอีกใบด้วย
--
-- แก้ด้วย RPC เดียวที่ครอบทั้ง 3 insert เป็น transaction เดียว (Postgres function เป็น
-- atomic โดยธรรมชาติ — ถ้า statement ไหน raise exception ทั้งฟังก์ชัน rollback หมด รวมถึง
-- jobs insert ที่ทำไปก่อนหน้าด้วย) ใช้ SECURITY INVOKER เพื่อให้ RLS policies เดิมของ
-- jobs/job_visibility_groups/job_workflow_steps ยังบังคับใช้ตาม role ผู้เรียกเหมือนเดิมทุกอย่าง
-- ไม่ได้ bypass สิทธิ์ใดๆ เพิ่มเติมจากที่มีอยู่แล้ว

create or replace function create_job_atomic(
  p_shop_id bigint,
  p_customer_id bigint,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_car_brand text,
  p_car_model text,
  p_car_year_display text,
  p_generation_id bigint,
  p_trim_id bigint,
  p_license_plate text,
  p_source_type text,
  p_notes text,
  p_photo_urls text[],
  p_damage_points jsonb,
  p_car_diagram_type text,
  p_created_by uuid,
  p_group_ids bigint[] default '{}',
  p_workflow_steps jsonb default '[]'::jsonb -- [{ "step_name": "...", "assigned_to": "uuid หรือ null" }, ...]
)
returns jobs
language plpgsql
security invoker
as $$
declare
  v_job jobs;
  v_group_id bigint;
  v_step jsonb;
  v_step_order int := 0;
begin
  insert into jobs (
    shop_id, customer_id, customer_name, customer_phone, customer_address,
    car_brand, car_model, car_year_display, generation_id, trim_id,
    license_plate, source_type, notes, photo_urls, damage_points,
    car_diagram_type, status, created_by
  ) values (
    p_shop_id, p_customer_id, p_customer_name, p_customer_phone, p_customer_address,
    p_car_brand, p_car_model, p_car_year_display, p_generation_id, p_trim_id,
    p_license_plate, p_source_type, p_notes, p_photo_urls, coalesce(p_damage_points, '[]'::jsonb),
    coalesce(p_car_diagram_type, 'sedan'), 'received', p_created_by
  )
  returning * into v_job;

  if p_group_ids is not null and array_length(p_group_ids, 1) > 0 then
    foreach v_group_id in array p_group_ids loop
      insert into job_visibility_groups (job_id, group_id) values (v_job.job_id, v_group_id);
    end loop;
  end if;

  if p_workflow_steps is not null and jsonb_array_length(p_workflow_steps) > 0 then
    for v_step in select * from jsonb_array_elements(p_workflow_steps) loop
      insert into job_workflow_steps (job_id, shop_id, step_order, step_name, assigned_to)
      values (
        v_job.job_id,
        p_shop_id,
        v_step_order,
        v_step->>'step_name',
        nullif(v_step->>'assigned_to', '')::uuid
      );
      v_step_order := v_step_order + 1;
    end loop;
  end if;

  return v_job;
end;
$$;

comment on function create_job_atomic is
  'สร้าง job + job_visibility_groups + job_workflow_steps เป็น transaction เดียว แก้ JOB-202/203 (non-atomic insert data leak). SECURITY INVOKER: RLS ของผู้เรียกยังบังคับใช้ตามเดิมทุกตาราง.';
