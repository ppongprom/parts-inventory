# ระบบสต็อกอะไหล่รถ (MVP)

หน้าที่มี 8 หน้า + 1 API route:
- `/` — ดูรายการ + ค้นหา/filter (ยี่ห้อ, ชื่ออะไหล่, โซนแบบ dropdown) — สลับมุมมอง List/Gallery ได้ — คลิกการ์ดเพื่อแก้ไข
- `/add` — เพิ่มอะไหล่ใหม่ (ถ่ายรูปได้หลายรูป + กรอกข้อมูล) — ปีดึงจากฐานข้อมูลอัตโนมัติ พิมพ์เองไม่ได้
- `/edit/[id]` — แก้ไขข้อมูล / เพิ่ม-ลบรูป (คลิกขยายได้) / ซ่อนอะไหล่ (soft delete)
- `/admin` — หน้ารวมตั้งค่าระบบ
- `/admin/car-data` — จัดการยี่ห้อ/รุ่น/ช่วงปีผลิต + ดูประวัติการแก้ไข (audit log)
- `/admin/zones` — จัดการรายการโซนจัดเก็บ (เพิ่ม/ลบ)
- `/admin/options` — จัดการ สภาพ/ที่มา/สถานะ (เพิ่ม/ลบ)
- `/admin/trash` — กู้คืน หรือลบอะไหล่ที่ถูกซ่อนไว้ถาวร
- `/api/car-generations` — server route รับ insert/update ข้อมูล generation พร้อมแนบ IP/User-Agent เข้า audit log

---

## ก่อนเริ่ม — เตรียม Supabase ให้ครบ 2 อย่าง

### 1. Table `parts` (ถ้ายังไม่ได้สร้าง รันใน SQL Editor)
```sql
create table parts (
  id uuid default gen_random_uuid() primary key,
  photo_url text,
  part_name text not null,
  car_brand text,
  car_model text,
  condition text,
  zone_code text,
  source_type text,
  price numeric,
  status text default 'available',
  created_at timestamp default now()
);

-- เปิด public read/insert สำหรับ MVP (ยังไม่มี login)
alter table parts enable row level security;

create policy "Allow public read" on parts
  for select using (true);

create policy "Allow public insert" on parts
  for insert with check (true);

-- เพิ่มสำหรับฟีเจอร์แก้ไข/ลบ
create policy "Allow public update" on parts
  for update using (true) with check (true);

create policy "Allow public delete" on parts
  for delete using (true);
```

### 3. เพิ่มคอลัมน์ `car_year` (สำหรับฟีเจอร์ autocomplete ยี่ห้อ/รุ่น/ปี)
ถ้า table `parts` สร้างไว้ก่อนหน้านี้แล้ว ต้องรัน SQL นี้เพิ่ม (ถ้าเพิ่งสร้าง table ใหม่ ข้ามได้เพราะ query ด้านบนควรเพิ่ม column นี้เข้าไปด้วยแล้ว):
```sql
alter table parts add column if not exists car_year integer;
```

### 4. Table `zones` (สำหรับหน้า admin จัดการโซนจัดเก็บ)
```sql
create table zones (
  id uuid default gen_random_uuid() primary key,
  code text not null unique,
  name text,
  created_at timestamp default now()
);

alter table zones enable row level security;

create policy "Allow public read zones" on zones
  for select using (true);

create policy "Allow public insert zones" on zones
  for insert with check (true);

create policy "Allow public delete zones" on zones
  for delete using (true);
```

### 5. Table `options` (สำหรับหน้า admin จัดการ สภาพ/ที่มา/สถานะ)
```sql
create table options (
  id uuid default gen_random_uuid() primary key,
  category text not null, -- 'condition' | 'source_type' | 'status'
  value text not null,
  sort_order integer default 0,
  created_at timestamp default now(),
  unique(category, value)
);

alter table options enable row level security;

create policy "Allow public read options" on options
  for select using (true);

create policy "Allow public insert options" on options
  for insert with check (true);

create policy "Allow public delete options" on options
  for delete using (true);

-- ใส่ค่าเริ่มต้นให้เหมือนของเดิม (รวม "มือสองตามสภาพ" ที่เพิ่มใหม่)
insert into options (category, value, sort_order) values
('condition', 'ใหม่', 1),
('condition', 'มือสอง-ดี', 2),
('condition', 'มือสอง-ซ่อม', 3),
('condition', 'มือสองตามสภาพ', 4),
('source_type', 'รถชน', 1),
('source_type', 'ประกัน total loss', 2),
('source_type', 'น้ำท่วม', 3),
('status', 'available', 1),
('status', 'reserved', 2),
('status', 'sold', 3);
```

### 6. เพิ่มคอลัมน์รองรับหลายรูป + soft delete
```sql
alter table parts add column if not exists photo_urls text[];
alter table parts add column if not exists is_active boolean default true;
```
คอลัมน์ `photo_urls` เก็บ array ของ URL รูปทั้งหมด (`photo_url` เดิมยังอยู่ เก็บรูปแรกไว้ใช้เป็น thumbnail) ส่วน `is_active` ใช้แทนการลบจริง — ตั้ง default เป็น `true` ทำให้ข้อมูลเก่าที่มีอยู่แล้วยังแสดงผลตามปกติโดยไม่ต้อง backfill เพิ่ม

### 7. ระบบ Login + Multi-Tenant (แยกข้อมูลตามอู่) + สิทธิ์ผู้ใช้ 5 ระดับ

**7.1 เปิด Email Auth ใน Supabase**
Dashboard → Authentication → Providers → เช็คว่า "Email" เปิดอยู่ (ปกติเปิดเป็น default)
แนะนำ: Authentication → Settings → ปิด "Confirm email" ไว้ก่อนช่วงทดสอบ (ไม่งั้นต้องเช็คอีเมลทุกครั้งที่ signup ทดสอบ) แล้วค่อยเปิดกลับตอน production จริง

**7.2 รันไฟล์ `db/auth_multi_tenant_schema.sql`** ทั้งไฟล์ใน SQL Editor
สร้าง `shops`, `shop_members`, `shop_invites`, `user_sessions` + RPC functions + RLS policy ที่บังคับแยกข้อมูลตามอู่ทุกตาราง (`parts`/`zones`/`options`)

⚠️ **หลังรันไฟล์นี้ ข้อมูล parts/zones/options เดิมทั้งหมดจะ "หายไป" ทันที** (ไม่ได้ลบจริง แค่ RLS จะซ่อนไว้เพราะยังไม่มี `shop_id`) ต้องทำขั้นต่อไปก่อนถึงจะเห็นข้อมูลเดิมอีกครั้ง

**7.3 สร้างบัญชีแรก (จะกลายเป็นเจ้าของอู่)**
เข้า `/signup` → กรอกชื่ออู่ + อีเมล + รหัสผ่าน → ระบบสร้าง shop ใหม่ให้อัตโนมัติ (เป็น `trialing` 14 วัน) และตั้งเป็น owner ทันที

**7.4 Migrate ข้อมูลเดิมเข้าอู่แรก (ทำครั้งเดียว)**
หา `shop_id` ของอู่ที่เพิ่งสร้าง (ดูใน Table Editor → `shops`) แล้วรัน SQL นี้ (แทนเลข `1` ด้วย shop_id จริง):
```sql
update parts   set shop_id = 1 where shop_id is null;
update zones   set shop_id = 1 where shop_id is null;
update options set shop_id = 1 where shop_id is null;
```
รีเฟรชหน้าเว็บ — ข้อมูลเดิมจะกลับมาแสดงในอู่ที่เพิ่งสร้างครบทุกอย่าง

**7.5 เชิญสมาชิกเพิ่ม**
เข้า `/admin/team` (owner/manager เท่านั้น) → กรอกอีเมล + เลือกบทบาท → กด "เชิญเข้าอู่" — คนที่ถูกเชิญต้องไป `/signup` ด้วยอีเมลเดียวกัน (ระบบจะรับคำเชิญอัตโนมัติหลัง signup/login)

**⚠️ ข้อจำกัดที่ทำไว้ในรอบนี้ (simplification):**
- Soft-delete (ปุ่ม "ลบ" ในหน้าแก้ไข) อนุญาตถึงระดับ **ช่าง** ด้วย (ตาม RLS update policy) แม้ตาม permission matrix ที่ออกแบบไว้จะระบุว่าควรเป็นแค่หัวหน้างานขึ้นไป — ถ้าต้องการแยกสิทธิ์ระดับ field-level แบบเป๊ะ ต้องแยก RLS policy หรือทำผ่าน RPC function เพิ่ม
- Concurrent session limit ทำงานแบบ **client-side enforcement** (เช็ค/บันทึกจากฝั่ง browser ตอน login) ไม่ใช่ server-side middleware ที่ block เด็ดขาด — เพียงพอสำหรับ MVP แต่ยังเลี่ยงได้ถ้าตั้งใจแฮ็ก
- ยังไม่มี middleware.js ป้องกัน route ฝั่ง server (ตอนนี้ป้องกันด้วย client-side redirect ใน `RequireAuth` เท่านั้น) — ถ้าต้องการความปลอดภัยสูงขึ้นควรเพิ่ม server-side session check ภายหลัง

### 7.6 สร้างบัญชีทันที (ไม่ต้องผ่านอีเมลยืนยัน)

นอกจาก "เชิญด้วยอีเมล" (ต้องให้พนักงานไป signup+ยืนยันอีเมลเอง) เพิ่มทางเลือกให้ owner/manager **สร้างบัญชีให้พนักงานได้ทันที** ผ่านหน้า `/admin/team` — เหมาะกับช่าง/พนักงานที่ไม่มีอีเมลจริงหรือไม่สะดวกทำขั้นตอนสมัคร

**วิธีทำงาน:** ใช้ API route `/api/team/create-member` (service role, เหมือน platform-admin) เรียก Supabase Admin API `auth.admin.createUser({ email_confirm: true })` สร้าง user พร้อม active ทันที ไม่ต้องผ่านขั้นตอนคำเชิญ/ยืนยันอีเมลเลย — owner/manager ตั้งอีเมล (ใช้อะไรก็ได้ที่ไม่ซ้ำ ไม่จำเป็นต้องเปิดได้จริง) + รหัสผ่าน (มีปุ่มสุ่มให้) แล้วส่งข้อมูลให้พนักงานเองทาง LINE/บอกปากเปล่า

**ความปลอดภัย:** API route เช็คสิทธิ์ owner/manager ของอู่นั้นก่อนทุกครั้ง (เทียบจาก token คนเรียก) ป้องกันไม่ให้ใครก็ได้มาสร้างสมาชิกในอู่คนอื่น

### 7.6 Platform Admin — หน้าดูรายชื่อทุกอู่ (คนละเรื่องกับ `/admin/team`)

`/admin/team` เป็นของ **เจ้าของอู่แต่ละอู่** เห็นแค่ทีมตัวเอง (ผ่าน RLS ปกติ) ส่วน `/platform-admin` เป็นของ **เจ้าของแพลตฟอร์ม (คุณอั้ม)** เห็นทุกอู่พร้อมกัน ต้องใช้สถาปัตยกรรมคนละแบบ (service role key ข้าม RLS) จึงแยกเป็นคนละระบบ

**ขั้นตอนติดตั้ง:**

1. รันไฟล์ `db/platform_admin_schema.sql` สร้าง table `platform_admins`
2. หา **Service Role Key** ที่ Supabase Dashboard → Project Settings → API Keys → Secret keys (`sb_secret_...`) — ใส่ในไฟล์ `.env.local` เป็น `SUPABASE_SERVICE_ROLE_KEY` (⚠️ ต้องใส่ใน Vercel Environment Variables ตอน deploy ด้วย และ **ต้องไม่มี** `NEXT_PUBLIC_` prefix เด็ดขาด ไม่งั้นหลุดไปฝั่ง browser)
3. Signup สร้างบัญชีตัวเองก่อน (ถ้ายังไม่มี) แล้วรัน SQL นี้ (แทนอีเมลด้วยของจริง):
```sql
insert into platform_admins (user_id)
select id from auth.users where email = 'your-email@example.com';
```
4. เข้า `/platform-admin` — เห็นสรุปสถิติรวม (จำนวนอู่ตามสถานะ + MRR ประมาณการ), ค้นหา/filter อู่, คลิกอู่เพื่อ**แก้ไข subscription status/plan/วันหมดอายุ** ได้จริง และดูรายชื่อสมาชิกของแต่ละอู่ (พร้อมอีเมล+บทบาท)

### 8. Schema ข้อมูลรถแบบ Relational (brands → models → model_generations) + Audit Trail

**สำคัญ: รันตามลำดับนี้เท่านั้น**

**7.1** รันไฟล์ `db/car_models_schema.sql` ทั้งไฟล์ใน SQL Editor ก่อน — สร้าง table `brands`/`models`/`model_generations`/`audit_log`, view `model_generations_display`, RPC functions (`get_or_create_brand`, `get_or_create_model`, `insert_model_generation`, `update_model_generation`) พร้อม RLS + grant execute ให้ครบ และเพิ่มคอลัมน์ `generation_id` + `car_year_display` ให้ตาราง `parts` ไปในตัว

**7.2** รันไฟล์ `db/car_models_migration_data.sql` ต่อ — import ข้อมูลรถ 311 รุ่นเดิม (จาก `lib/carModels.json`) เข้า schema ใหม่ทั้งหมด โดย**ไม่เสียข้อมูลเดิมแม้แต่แถวเดียว**

> **หมายเหตุการ migrate:** รอบแรกนี้ import แบบ 1 แถวเดิม = 1 model + 1 generation (ตั้ง `generation_code` เป็นช่วงปีไปก่อน เช่น `"2005-2015"`) เพื่อไม่ให้เสียข้อมูล จากนั้นค่อยๆ ไปแยก/ปรับ generation code ให้ละเอียดขึ้น (เช่นแยก AE100/AE111 ออกจาก Corolla Altis) ทีหลังผ่านหน้า `/admin/car-data` ได้ทุกเมื่อ — ไม่ต้องแก้ครั้งเดียวให้สมบูรณ์ตั้งแต่แรก

**ทำไมต้องออกแบบแบบนี้:**
- ช่อง "ปี" ในหน้าเพิ่ม/แก้ไขอะไหล่ **ไม่ให้ user พิมพ์เองอีกต่อไป** — ต้องเลือกรถจากช่องค้นหาเท่านั้น ระบบจะ prefill ปีเป็น format `year_start - year_end_or_status` ให้อัตโนมัติจาก view `model_generations_display`
- การแก้ไข/เพิ่มข้อมูล generation (ปีของแต่ละรุ่น) ทุกครั้งจะถูกบันทึกลง `audit_log` เสมอ — เก็บว่า **แก้เมื่อไหร่ + IP + browser (User-Agent)** ของคนแก้ (ยังไม่มีระบบ login จึงใช้ IP/browser แทนตัวตนไปก่อน) ดูประวัติได้ที่หน้า `/admin/car-data` ปุ่ม "📜 ประวัติ" ในแต่ละ generation
- การเขียนข้อมูลทั้งหมดถูกบังคับให้ผ่าน RPC function (`security definer`) เท่านั้น — ตาราง `model_generations` เปิด RLS แบบอ่านได้อย่างเดียวสำหรับ public ไม่มี policy insert/update ตรงๆ จึงเขียนข้าม audit log ไม่ได้เลย

**ทำไมต้องมี API route (`app/api/car-generations/route.js`):**
Postgres function รู้ไม่ได้ว่า IP/browser ของคนเรียกคืออะไร — ข้อมูลนี้อยู่ใน HTTP request ที่ยิงมาที่ Next.js เท่านั้น จึงต้องมี server route อ่าน header `x-forwarded-for` และ `user-agent` จาก request แล้วส่งต่อเข้า RPC ให้ — เรียกตรงจาก browser ไปที่ Supabase RPC เฉยๆ จะไม่มี IP/UA ที่ถูกต้องให้บันทึก

### 2. Storage bucket `part-photos`
Dashboard → Storage → New bucket → ชื่อ `part-photos` → ตั้งเป็น **Public**

จากนั้นต้องเพิ่ม policy ให้ upload ได้ (Storage → Policies):
```sql
create policy "Allow public upload"
on storage.objects for insert
with check (bucket_id = 'part-photos');

create policy "Allow public read photos"
on storage.objects for select
using (bucket_id = 'part-photos');
```

---

### 9. งานเข้าอู่ (Jobs) — รับ/ติดตามงานซ่อม แยกจากข้อมูลสต็อก

รัน `db/jobs_schema.sql` ใน SQL Editor — สร้างตาราง `jobs` (เก็บข้อมูลลูกค้า+รถ+สถานะ+ผู้รับผิดชอบ) พร้อม RLS แบบ shop-scoped เหมือนตารางอื่น และเพิ่มคอลัมน์ `job_id` ให้ `parts` (nullable) เผื่ออยากโยงว่าอะไหล่ชิ้นไหนถอดมาจากงานไหน

**หน้าที่เพิ่ม:**
- `/jobs` — รายการงาน + filter สถานะ + ค้นหา
- `/jobs/new` — รับงานใหม่ (ถ่ายรูปสภาพรถ, ข้อมูลลูกค้า, ค้นหารถจากฐานข้อมูล)
- `/jobs/[id]` — แก้ไข/เปลี่ยนสถานะ/มอบหมายช่าง/ลบงาน

**สถานะงาน:** รับเรื่องแล้ว → กำลังซ่อม → รออะไหล่ → ซ่อมเสร็จแล้ว → ส่งมอบแล้ว (หรือยกเลิก)

**หลักการสำคัญ:** ข้อมูลลูกค้า (ชื่อ/เบอร์โทร) อยู่ใน `jobs` เท่านั้น **ไม่ปนกับตาราง `parts`** ตามหลักการที่ตกลงกันไว้ตั้งแต่มีตติ้งแรก — ถ้าอยากรู้ว่าอะไหล่ชิ้นไหนมาจากงานไหน ใช้ `job_id` เชื่อมแทน ไม่ต้อง copy ข้อมูลลูกค้าไปซ้ำ

### 10. Customer Portal — ลิงก์ให้ลูกค้าดูรายการซ่อม+ค่าใช้จ่าย+พิมพ์ PDF

รัน `db/customer_portal_schema.sql` เพิ่ม (ต้องรันหลัง `jobs_schema.sql` เพราะอ้างอิงตาราง `jobs`)

**สร้างเพิ่ม:**
- table `customers` — ผูกด้วยเบอร์โทร (1 ลูกค้าเห็นได้ทุกคัน/ทุกงานผ่านลิงก์เดียว)
- table `job_cost_items` — รายการค่าใช้จ่าย (ค่าแรง/ค่าอะไหล่/อื่นๆ) ต่องาน
- `jobs.closed_at` — บันทึกอัตโนมัติเมื่อสถานะเปลี่ยนเป็นซ่อมเสร็จ/ส่งมอบ/ยกเลิก

**กฎการมองเห็นของลูกค้า:** เห็นงานที่ยังไม่ปิด + งานที่ปิดมาไม่เกิน **731 วัน** นับจากวันที่ปิดงาน (`closed_at`) — เกินกว่านั้นจะมองไม่เห็นอัตโนมัติ ไม่ต้องลบข้อมูลจริง

**หน้าที่เพิ่ม:**
- `/share/customer/[token]` — รายการงานซ่อมทั้งหมดของลูกค้า (public ไม่ต้อง login)
- `/share/customer/[token]/job/[jobId]` — รายละเอียด+รายการค่าใช้จ่าย+ปุ่มพิมพ์เป็น PDF (ใช้ browser print)
- ในหน้า `/jobs/[id]` (แอดมิน) เพิ่มส่วนจัดการรายการค่าใช้จ่าย + ปุ่ม "คัดลอกลิงก์ให้ลูกค้า"

**ความปลอดภัย:** เข้าถึงผ่าน API route ที่ใช้ Service Role Key เท่านั้น (เหมือน Platform Admin) — ไม่เปิด RLS ให้ query ตรงๆ จาก public เด็ดขาด แต่ละ token ผูกกับลูกค้าคนเดียว เดา job_id ของคนอื่นดูไม่ได้

**พิมพ์เป็น PDF:** ใช้ browser print (`window.print()`) พร้อม print stylesheet ซ่อนปุ่ม/nav ให้เหลือแค่เนื้อหาใบสรุป — ลูกค้ากด "พิมพ์" ในเบราว์เซอร์แล้วเลือก "Save as PDF" ได้เลย ไม่ต้องติดตั้ง library เพิ่ม

### 11. Jobs Phase A-D Upgrade — ปรับให้ใกล้เคียงระบบซ่อมรถที่ใช้งานจริง

รัน `db/jobs_phase_upgrade_schema.sql` เพิ่ม (ต้องรันหลัง `jobs_schema.sql` และ `customer_portal_schema.sql`)

**Phase A — เร็วขึ้น + VAT:**
- จัดลำดับรายการค่าใช้จ่ายได้ (ปุ่ม ▲▼)
- เพิ่มรายการเร็วขึ้น: พิมพ์ขึ้นต้นด้วย "ค่า" จะเดาเป็นหมวดค่าแรงให้อัตโนมัติ (ยังกดปุ่มเลือกหมวดเองทับได้)
- VAT toggle (Non-VAT / VAT 7%) คำนวณให้อัตโนมัติ

**Phase B — เอกสาร 3 ประเภท (ใบรับรถ/ใบเสนอราคา/ใบแจ้งหนี้):**
- table `job_documents` เก็บ **snapshot แช่แข็งข้อมูล ณ ตอนสร้างเอกสาร** — แก้ราคาทีหลังไม่กระทบเอกสารเก่าที่พิมพ์ไปแล้ว
- เลขที่เอกสารอัตโนมัติ format `YYMM-<timestamp>`
- หน้า `/jobs/[id]/documents/[documentId]` แสดง+พิมพ์เอกสารตาม `doc_type` — ใบแจ้งหนี้แยกคอลัมน์ค่าแรง/ค่าอะไหล่ ใบเสนอราคาคำนวณ VAT ให้

**Phase C — หน้ารายการงานใหม่:**
- Icon tabs (ทั้งหมด/เปิดอยู่/ปิดแล้ว) แทน dropdown พร้อมตัวนับแต่ละแท็บ
- Layout กระชับ: ยี่ห้อ+รุ่น+ทะเบียนซ้าย, ลูกค้า+หมายเหตุขวา, ไอคอนสถานะ 🔧/✅ ดูง่ายแวบเดียว

**Phase D — แผนภาพจุดเสียหาย:**
- Component `CarDamageDiagram` — โครงรถ SVG 3 มุม (หน้า/ข้าง/หลัง) แตะเพื่อมาร์กจุด+ใส่หมายเหตุ
- เก็บเป็น `jobs.damage_points` (jsonb array พิกัดสัดส่วน 0-1 responsive ไม่ผูก pixel)
- แสดงในใบรับรถอัตโนมัติ (โชว์ทั้ง 3 มุมพร้อมกันตอนพิมพ์)

### 13. Phase E — กลุ่มผู้ใช้ (Visibility) + ขั้นตอนงาน (Workflow Steps) + เตรียมต่อ Grafana

รัน `db/visibility_groups_and_workflow_schema.sql` เพิ่ม (ต้องรันหลัง `jobs_schema.sql` เพราะแก้ RLS policy ของ `jobs`) แล้วรัน **`db/job_multi_group_migration.sql`** ต่อทันที (เปลี่ยนจาก 1 กลุ่มต่องาน เป็นหลายกลุ่มต่องาน — ต้องรันคู่กันเสมอ ไม่รันแยกทีละไฟล์)

**กลุ่มผู้ใช้ (Visibility Groups):**
- หน้า `/admin/groups` — สร้างกลุ่มตามสาขา/ความชำนาญ (เช่น "ช่างเครื่อง", "ช่างสี", "ช่างไฟฟ้า" — เพิ่มได้ไม่จำกัด) เพิ่ม/ลบสมาชิกในกลุ่ม
- ตอนรับงานใหม่ เลือกได้ว่าให้ "ทุกคนเห็น" (ค่าเริ่มต้น ไม่เลือกกลุ่มเลย) หรือเลือก **กลุ่มได้มากกว่า 1 กลุ่มต่องาน** (เช่น งานที่ต้องทั้งช่างเครื่องและช่างสีร่วมกันดู)
- ผูกความสัมพันธ์แบบ many-to-many ผ่านตาราง `job_visibility_groups` — 1 งานอยู่ได้หลายกลุ่ม, 1 กลุ่มดูได้หลายงาน
- **เจ้าของ/ผู้จัดการเห็นทุกงานเสมอ** ไม่ว่าจะอยู่กลุ่มไหน (ผ่านฟังก์ชัน `can_view_job` ที่แก้ RLS policy ของ `jobs`)

**ขั้นตอนงาน (Workflow Steps):**
- ตอนรับงานใหม่ระบุขั้นตอนคร่าวๆ ได้เลย (ชื่อขั้นตอน + ผู้รับผิดชอบ) เพิ่ม/ลบแถวได้ไม่จำกัด
- ในหน้า `/jobs/[id]` จัดการขั้นตอนต่อได้เต็มรูปแบบ: เพิ่ม/ลบ/จัดลำดับ (▲▼)/มอบหมายใหม่/เปลี่ยนสถานะ (ยังไม่เริ่ม → กำลังทำ → เสร็จแล้ว/ข้าม)
- `started_at`/`completed_at` บันทึกอัตโนมัติเมื่อเปลี่ยนสถานะ (ผ่าน trigger `update_job_workflow_step_timestamps`)

**เตรียมต่อ Grafana:**
- สร้าง 3 SQL views ที่ query ง่ายสำหรับทำ dashboard:
  - `grafana_job_step_durations` — ระยะเวลาที่ใช้ต่อขั้นตอน (นาที)
  - `grafana_workload_by_assignee` — งานค้าง/เสร็จแล้วต่อคน
  - `grafana_job_lifecycle` — ระยะเวลารวมต่องานตั้งแต่รับเข้าจนปิดงาน
- Grafana ต่อ Postgres ของ Supabase ได้โดยตรง (Project Settings → Database → connection string) — **แนะนำสร้าง Postgres role แบบ read-only แยกให้ Grafana** (คำสั่ง SQL อยู่ท้ายไฟล์ schema) ไม่ควรใช้ service role key หรือ user หลัก

### 14. ใบแจ้งหนี้ตามข้อกำหนดกรมสรรพากร (มาตรา 86/4)

รัน `db/tax_invoice_compliance_migration.sql` เพิ่ม — เพิ่มคอลัมน์ที่กฎหมายกำหนดให้ใบกำกับภาษีเต็มรูปต้องมี:

- `shops.address`, `shops.tax_id` (เลขผู้เสียภาษี 13 หลัก), `shops.phone` — ตั้งค่าได้ที่ `/admin` (การ์ด "🏢 ข้อมูลร้าน/อู่")
- `customers.address`, `jobs.customer_address` — ที่อยู่ผู้ซื้อ/ผู้รับบริการ (กรอกตอนรับงานใหม่ หรือแก้ทีหลังได้)

**หน้าใบกำกับภาษี/ใบแจ้งหนี้ (`doc_type: 'billing'`)** ตอนนี้มีครบตามมาตรา 86/4:
1. คำว่า "ใบกำกับภาษี / ใบแจ้งหนี้" เด่นชัด
2. ชื่อ ที่อยู่ เลขผู้เสียภาษีของร้าน
3. ชื่อ ที่อยู่ ผู้ซื้อ/ผู้รับบริการ
4. เลขที่เอกสาร (running number จาก `generate_doc_number`)
5. รายการสินค้า/บริการ + มูลค่า
6. VAT แยกออกจากมูลค่าสินค้าให้ชัดเจน
7. วันที่ออกเอกสาร
8. ขึ้นคำเตือนสีแดงถ้ายังไม่ได้ตั้งเลขผู้เสียภาษี — เตือนก่อนออกเอกสารจริง

**ใบรับรถ/ใบเสนอราคา** ปรับ layout ให้เหมือนกัน (หัวเอกสาร, กล่องข้อมูลลูกค้า+รถ, ช่องเซ็นชื่อท้ายเอกสาร) ตามที่ขอให้ "คล้ายใบแจ้งหนี้" — ต่างกันแค่ไม่บังคับต้องมีเลขผู้เสียภาษี/ที่อยู่ เพราะไม่ใช่เอกสารภาษีตามกฎหมาย

**⚠️ ข้อจำกัด:** ยังไม่ได้ทำ "ปริมาณ" (quantity) แยกเป็นคอลัมน์ตัวเลขในตารางรายการ (กฎหมายกำหนดไว้ แต่ระบบปัจจุบันเก็บแค่คำอธิบาย+มูลค่ารวมต่อรายการ ไม่มี quantity/unit price แยก) — ถ้าต้องการให้ครบ 100% ต้องแก้ schema ตาราง `job_cost_items` เพิ่ม บอกได้เลยถ้าต้องการให้ทำต่อ

### 12. Theme สว่าง/มืด + ปรับความกว้างช่องค้นหารถ

**Theme:** เพิ่ม `lib/ThemeProvider.js` จัดการ light/dark ผ่าน CSS variable บน `<html data-theme="...">` — default เป็น **สีสว่าง** เสมอ ปรับได้ที่ `/admin` (การ์ด "🎨 ธีมสี") ค่าที่เลือกจำไว้ใน localStorage ของเครื่องนั้นๆ (คนละเครื่องเลือกไม่เหมือนกันได้)

**สถานะ:** แก้ครบ 100% แล้ว — ไล่แทนที่สี hardcode ทั้งหมด (307 จุด ใน 19 ไฟล์) ด้วย CSS variable เรียบร้อย ทุกหน้ารวม modal/lightbox/ปุ่มต่างๆ ปรับตาม theme ถูกต้องครบ

**ช่องค้นหารถ:** ปรับความกว้างเหลือ 50% ของพื้นที่ (มี min-width 220px กันแคบเกินบนจอเล็ก) แก้ที่ `components/CarAutocomplete.js` จุดเดียว มีผลกับทุกหน้าที่เรียกใช้ (`/add`, `/edit/[id]`, `/jobs/new`) อัตโนมัติ



```bash
# 1. ติดตั้ง dependencies
npm install

# 2. คัดลอกไฟล์ env แล้วกรอกค่าจริง
cp .env.local.example .env.local
# แก้ .env.local ใส่ NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

# 3. รันแบบ dev (ทดสอบในเครื่อง)
npm run dev
# เปิด http://localhost:3000
```

## Deploy ขึ้น Vercel
1. Push โค้ดขึ้น GitHub repo
2. เข้า vercel.com → New Project → เลือก repo นี้
3. ใส่ Environment Variables 2 ตัว (เหมือนใน .env.local) ในหน้า Vercel project settings
4. Deploy

---

## โครงสร้างไฟล์
```
parts-inventory/
├── app/
│   ├── layout.js       ← layout หลัก (ครอบด้วย AuthProvider)
│   ├── globals.css     ← สไตล์
│   ├── page.js         ← หน้าแรก (list + search, ต้อง login)
│   ├── login/
│   │   └── page.js     ← เข้าสู่ระบบ
│   ├── signup/
│   │   └── page.js     ← สมัคร + สร้างอู่ใหม่ (กลายเป็น owner)
│   ├── add/
│   │   └── page.js     ← หน้าเพิ่มอะไหล่
│   ├── edit/
│   │   └── [id]/
│   │       └── page.js ← หน้าแก้ไข/ลบอะไหล่ (คลิกรูปขยายได้)
│   ├── api/
│   │   └── car-generations/
│   │       └── route.js ← server route แนบ IP/UA เข้า audit log
│   └── admin/
│       ├── page.js         ← หน้ารวมตั้งค่า
│       ├── team/
│       │   └── page.js     ← เชิญสมาชิก จัดการสิทธิ์ (owner/manager)
│       ├── car-data/
│       │   └── page.js     ← จัดการยี่ห้อ/รุ่น/generation + ดูประวัติ (ข้อมูลกลาง ไม่แยกตามอู่)
│       ├── zones/
│       │   └── page.js     ← จัดการโซนจัดเก็บ
│       ├── options/
│       │   └── page.js     ← จัดการ สภาพ/ที่มา/สถานะ
│       └── trash/
│           └── page.js     ← กู้คืน/ลบอะไหล่ถาวร
├── components/
│   ├── CarAutocomplete.js  ← ค้นหายี่ห้อ/รุ่น/ปี (query จาก Supabase สด)
│   ├── RequireAuth.js      ← ป้องกันหน้าที่ต้อง login + เช็ค role
│   ├── IdleSessionGuard.js ← ครอบไว้ใน RequireAuth จัดการ auto logout
│   └── IdleLogoutModal.js  ← UI นับถอยหลังก่อน logout
├── config/
│   └── subscriptionTiers.js ← ราคา/limit แต่ละ tier (แก้ที่นี่ที่เดียว)
├── db/
│   ├── auth_multi_tenant_schema.sql   ← รันคู่กับการเปิด Auth (shops/members/sessions)
│   ├── car_models_schema.sql          ← รันครั้งแรกก่อนเสมอ (สร้าง schema/RPC/RLS ข้อมูลรถ)
│   └── car_models_migration_data.sql  ← รันต่อ (import ข้อมูลรถ 311 รุ่นเดิม)
├── lib/
│   ├── supabaseClient.js
│   ├── AuthProvider.js     ← React context: session, shop ปัจจุบัน, role
│   ├── sessionTracking.js  ← บังคับ maxDevicesPerUser/maxConcurrentSessions
│   ├── useIdleTimeout.js   ← hook ตรวจจับ idle + นับถอยหลัง
│   ├── carModels.json      ← ⚠️ เก็บไว้อ้างอิง/ใช้สร้าง migration เท่านั้น แอปไม่ import ใช้แล้ว
│   ├── zoneStorage.js      ← จำโซนล่าสุดที่เลือก (localStorage)
│   ├── viewModeStorage.js  ← จำโหมดแสดงผล list/gallery (localStorage)
│   ├── imageResize.js      ← ย่อ/บีบอัดรูปก่อนอัปโหลด
│   └── storageHelpers.js   ← อัปโหลด/ลบรูปใน Supabase Storage
├── package.json
├── next.config.mjs
└── .env.local.example
```

## ฟีเจอร์ Login + Multi-Tenant + สิทธิ์ผู้ใช้
- **Signup** สร้างอู่ใหม่ + เป็น owner ทันที เริ่ม trial 14 วันอัตโนมัติ
- **5 บทบาท**: เจ้าของ, ผู้จัดการ, หัวหน้างาน, ช่าง, ผู้ช่วยช่าง — สิทธิ์ต่างกันตาม RLS policy (ดูตาราง permission matrix ที่คุยกันไว้)
- **แยกข้อมูลตามอู่สนิท** ผ่าน Row Level Security — อู่ A มองไม่เห็นข้อมูลอู่ B เด็ดขาด (ยกเว้นข้อมูลรถ brands/models/generations ที่เป็นข้อมูลกลางใช้ร่วมกัน)
- **จำกัดอุปกรณ์/session พร้อมกัน** ตาม tier (`config/subscriptionTiers.js`) — login เครื่องที่ 3 จะเตะเครื่องเก่าสุดออกอัตโนมัติถ้าเกิน `maxDevicesPerUser`
- **Auto logout เมื่อไม่มีกิจกรรม 15 นาที** ขึ้นนับถอยหลัง 100 วินาทีก่อน logout จริง (ปรับตัวเลขได้ที่ `config/subscriptionTiers.js`)

## ฟีเจอร์ Autocomplete ยี่ห้อ/รุ่น/ปี (query จากฐานข้อมูลจริง)
พิมพ์ 2 ตัวอักษรขึ้นไปในช่อง "🔍 ค้นหารถ" — ค้นจาก view `model_generations_display` แบบ debounce (250ms) ทั้งยี่ห้อ/รุ่น/generation code พร้อมกัน เลือกแล้วเติมยี่ห้อ/รุ่น และ**ช่องปีจะ prefill อัตโนมัติเป็น read-only เสมอ** (format `year_start - year_end_or_status`) — **ไม่มีช่องให้พิมพ์ปีเองอีกต่อไป** ถ้าพิมพ์ยี่ห้อ/รุ่นเองโดยไม่เลือกจาก autocomplete (เช่นรถที่ยังไม่มีในฐานข้อมูล) ช่องปีจะว่าง/ไม่มีข้อมูลให้ — ต้องไปเพิ่มรุ่นนั้นที่หน้า `/admin/car-data` ก่อนถึงจะมีปีให้เลือกในครั้งถัดไป

## ฟีเจอร์ถ่ายรูปจากมือถือ
ปุ่ม "📷 ถ่ายรูปอะไหล่" เปิดกล้องมือถือโดยตรง (ไม่ต้องผ่านตัวเลือกไฟล์ระบบ) ถ่ายเสร็จรูปจะขึ้น preview ในหน้าทันทีอัตโนมัติ ในหน้าแก้ไข คลิกที่รูป preview เพื่อขยายดูแบบเต็มจอได้ (คลิกซ้ำเพื่อปิด)

## ฟีเจอร์จัดการโซนจัดเก็บ (Admin)
หน้า `/admin/zones` ใช้เพิ่ม/ลบรายชื่อโซนที่มีจริงในอู่ (เช่น JP-A1, EU-B3) พอมีโซนในระบบแล้ว หน้าเพิ่ม/แก้ไขอะไหล่จะเปลี่ยนจากช่องพิมพ์อิสระเป็น dropdown เลือกจากลิสต์นี้แทน — และจะ**จำโซนล่าสุดที่เลือกไว้เป็นค่า default** สำหรับเพิ่มอะไหล่ชิ้นถัดไป จนกว่าจะเปลี่ยนเอง (สะดวกเวลาต้องเพิ่มอะไหล่หลายชิ้นจากโซนเดียวกันติดกัน) หน้าแรกก็ filter ตามโซนแบบ dropdown เดียวกันนี้ด้วย

## ฟีเจอร์จัดการ สภาพ/ที่มา/สถานะ (Admin)
หน้า `/admin/options` ใช้เพิ่ม/ลบตัวเลือกในแต่ละหมวด (สภาพ, ที่มา, สถานะ) แทนที่จะ hardcode ไว้ในโค้ด — เพิ่มตัวเลือกใหม่ได้ทันทีโดยไม่ต้องแก้โค้ด

## ฟีเจอร์ Optimize Bandwidth / Storage
- **Resize รูปก่อนอัปโหลด**: ย่อเหลือด้านยาวสุด 2000px คุณภาพ JPEG ~87% (ทำงานฝั่ง browser ด้วย canvas, ดู `lib/imageResize.js`)
- **Pagination หน้าแรก**: โหลดครั้งละ 50 ชิ้น (`PAGE_SIZE` ใน `app/page.js`) เรียงจากล่าสุดไปเก่าสุดเสมอ พร้อมปุ่ม "โหลดเพิ่มเติม" — ค้นหา/filter ทำที่ฝั่ง database โดยตรง
- **Lazy loading รูปภาพ**: ใช้ `loading="lazy"` ให้ browser โหลดเฉพาะรูปที่เลื่อนมาเห็นจริง

## ฟีเจอร์รูปหลายใบต่ออะไหล่
เพิ่ม/แก้ไขอะไหล่ได้หลายรูปต่อ 1 ชิ้น (บังคับอย่างน้อย 1 รูปก่อนบันทึกเสมอ) กดปุ่มถ่าย/เลือกรูปซ้ำได้เรื่อยๆ เพื่อเพิ่มรูปทีละใบ มีปุ่ม × ลบรูปที่ไม่ต้องการออกจากรายการก่อนบันทึก คลิกรูป thumbnail เพื่อขยายดูได้ (lightbox) รูปแรกในลิสต์จะถูกใช้เป็น thumbnail หลักในหน้ารายการ

## ฟีเจอร์มุมมอง List / Gallery
หน้าแรกสลับมุมมองได้ที่ปุ่มขวาบนแถบ filter — **List (default)** แสดงรายละเอียดครบ, **Gallery** แสดงเป็น grid รูปภาพเน้นดูภาพรวม เลือกโหมดไว้แล้วจะจำไว้ (localStorage) ใช้ครั้งต่อไปโดยไม่ต้องเลือกซ้ำ

## ฟีเจอร์ Soft Delete (ถังขยะ)
กด "ลบ" ในหน้าแก้ไขจะไม่ลบข้อมูลจริง แต่จะซ่อนออกจากหน้าแรก (ตั้ง `is_active = false`) เท่านั้น ไปกู้คืนหรือลบถาวรจริงได้ที่ `/admin/trash` — ตอนลบถาวรระบบจะลบไฟล์รูปทั้งหมดออกจาก Storage ให้อัตโนมัติด้วย (best-effort)


## ทดสอบว่าใช้ได้จริง
1. เปิด `/add` → ถ่ายรูป (หรือเลือกไฟล์) + กรอกชื่ออะไหล่ → กด "บันทึกอะไหล่"
2. จะเด้งกลับหน้าแรกอัตโนมัติ เห็นรายการที่เพิ่งเพิ่ม
3. ลองพิมพ์ค้นหา/เลือก filter ยี่ห้อ/โซน ดูว่ากรองถูกต้อง

## ยังไม่ทำใน MVP นี้ (ตามที่ตกลงกันไว้)
- ❌ Login / role แยกสิทธิ์
- ❌ AI auto-post ไปโซเชียล
- ❌ ระบบขาย/ชำระเงิน
- ❌ ข้อมูลลูกค้า (เก็บแยกจากระบบนี้โดยเจตนา)

### 15. Phase 1-3 — แยกประเภทอะไหล่ + คุมสต็อก Consumable + ติดตามอะไหล่ถอด/กำไร

รัน `db/parts_classification_and_tracking_migration.sql`

**Phase 1 — แยก Salvage vs Consumable:**
- เพิ่ม `parts.item_type` (`salvage` = อะไหล่ถอดจากรถ / `consumable` = ของสิ้นเปลืองในงานซ่อม)
- หน้า `/add`, `/edit/[id]` มีปุ่มเลือกประเภทตั้งแต่แรก

**Phase 2 — คุมสต็อก Consumable:**
- เพิ่ม `parts.min_stock_level` + view `low_stock_parts` (เทียบ `quantity <= min_stock_level` ฝั่ง SQL เพราะ Supabase filter เทียบ 2 คอลัมน์กันเองตรงๆ ไม่ได้)
- หน้าแรกมี banner สีเหลืองแจ้งเตือนจำนวนของใกล้หมด กดแล้ว filter เฉพาะรายการนั้นได้

**Phase 3 — ติดตามอะไหล่ถอด + กำไรต่อคัน:**
- เพิ่ม `jobs.vehicle_purchase_price` (ราคาซื้อรถทั้งคัน)
- หน้า `/jobs/[id]` มีส่วน "ต้นทุน-กำไร" คำนวณจากอะไหล่ที่ผูก `job_id` กับงานนั้นแล้วขายแล้ว (`status='sold'`) เทียบกับราคาซื้อรถ
- หน้า `/add?job_id=X` (ลิงก์จากหน้างาน) ผูกอะไหล่ใหม่เข้ากับงานนั้นอัตโนมัติ
- หน้า `/edit/[id]` โชว์ "อยู่ในสต็อกมาแล้ว N วัน" + ลิงก์ย้อนกลับไปงานต้นทาง (ใช้หลัก FSN Analysis หาของค้างสต็อก)

**⚠️ ข้อจำกัด:** กำไรที่คำนวณเป็นตัวเลขประมาณการเทียบยอดขายสะสมกับราคาซื้อรถอย่างเดียว **ยังไม่รวมค่าแรงถอดแยก/ค่าใช้จ่ายอื่น** — เหมาะเป็นตัวเลขอ้างอิงคร่าวๆ ไม่ใช่ต้นทุนที่แม่นยำ 100%

### 16. คืนวันที่ 20 ก.ค. 2026 — งาน QA อัตโนมัติภาคกลางคืน (nightly automated run)

**ฟีเจอร์ใหม่/แก้ไข:**
- **แก้บั๊ก Android Chrome ถ่ายรูปแล้วหน้า `/add` รีเซ็ต** (`lib/addFormRecovery.js`) — Android
  อาจฆ่า background tab process ตอนเปิดแอปกล้อง native ทำให้ Chrome ต้อง reload หน้าใหม่ทั้งหมด
  ตอนนี้กู้คืนฟอร์ม+รูปจาก sessionStorage อัตโนมัติพร้อมแจ้งเตือน
- **เพิ่ม "ลืมรหัสผ่าน?" ที่ `/login`** + หน้า `/reset-password` รับลิงก์ — เจ้าของอู่รีเซ็ตรหัสผ่าน
  ตัวเองได้เอง ไม่ต้องพึ่ง `scripts/reset-owner-password.mjs` รันมือถาวรอีกต่อไป (ปุ่มรีเซ็ต
  PIN/รหัสผ่านให้สมาชิกคนอื่นใน `/admin/team` มีอยู่ก่อนแล้ว ใช้ได้ทั้งบัญชี username+PIN และอีเมล)
- **Platform admin role tiers** (Super Admin / Support / Analyst) — บังคับ permission matrix
  ที่ระดับ API ทุก endpoint ใต้ `/api/platform/*` ไม่ใช่แค่ซ่อนปุ่มใน UI ใหม่: route จัดการ
  platform_admins เอง (`/api/platform/admins`) พร้อมกันคนสุดท้ายที่เป็น Super Admin ถูก demote/ลบ
- **Platform admin Activity Log** — บันทึกทุกการกระทำที่กระทบลูกค้า (แก้ subscription, join-as-
  support, จัดการ platform admin) ผ่าน Postgres RPC ที่ทำ mutation + เขียน log ในทรานแซคชัน
  เดียวกัน (log เขียนไม่สำเร็จ = การกระทำหลัก rollback ด้วย) มีแท็บ "Activity Log" ในหน้า
  `/platform-admin` ให้ดู timeline + filter
- **Export CSV อะไหล่** (`/admin` → "Export CSV") — จำกัดสิทธิ์ Owner/Manager/Supervisor,
  จำกัด tier Starter ขึ้นไป (Trial export ไม่ได้) ยังไม่รองรับ Jobs/Sales CSV (รอ payment_method
  และ cart-based selling flow ที่ยังไม่มีจริงในระบบก่อน)
- **แก้บั๊ก "silent session kick"** — user ที่ registerSession ล้มเหลว (เช่น ชนกับ concurrent
  session limit ของ tier) ตอนนี้เห็นข้อความอธิบายที่ `/login`/`/staff-login` แทนที่จะโดนเด้ง
  กลับเฉยๆ ไม่รู้สาเหตุ

**Schema drift ที่แก้ (พบ 5 จุดคืนนี้ — DB จริงบน staging นำหน้าไฟล์ใน git ไปมาก):**
- `db/car_data_full_resync_2026-07-20.sql` — export `model_trims` (1508 แถว) + `model_generations`
  (397 แถว) ที่ขาดหายจากไฟล์ seed เดิม ใช้ name-based lookup (ไม่ใช่ raw id) กันปัญหา id ไม่ตรงกัน
  ข้าม environment — พบด้วยว่า `db/vehicle_trims_toyota_honda_nissan_mazda_isuzu_mitsubishi.sql`
  เดิมใช้ raw `generation_id` ทำให้ fresh install ที่ id ไม่ตรงจะเสียข้อมูลทั้งไฟล์แบบ atomic
- `db/platform_admin_role_tiers_and_audit_log_migration.sql` + `db/platform_audit_log_transactional_rpc_migration.sql`
  — `platform_admins.role` และ `platform_audit_log` มีอยู่แล้วบน DB จริงแต่ไม่เคย commit
- `db/zones_owner_type_migration.sql` — `zones.owner_type` + `owner_entity_id` (prerequisite ของ
  Accounting Module) มีอยู่แล้วบน DB จริง + มี UI ใน `/admin/zones` แล้ว แต่ไม่เคย commit
- `db/audit_log_changed_by_user_id_fix_migration.sql` — 4 RPC เดิม (insert/update_model_generation,
  insert/update_model_trim) ไม่เคยใส่ `changed_by_user_id` เลย รู้แค่ IP/user agent ไม่รู้ว่าใครแก้
- `db/visibility_groups_and_workflow_schema.sql` — ไฟล์นี้ถูกอ้างอิงจาก README + migration อื่น
  มาตลอดแต่ไม่เคยมีอยู่ใน repo จริงเลย ถูก reconstruct จาก schema จริงบน staging (verify แล้วว่า
  fresh install ให้ผลตรงกับ staging ทุก column/constraint/policy)

**เอกสารที่สร้างใหม่ (การ์ด Notion อ้างว่ามีอยู่แล้วแต่ไม่เคย commit จริง):** `SOP.md`,
`USER_MANUAL.md`

**⚠️ กระบวนการกัน drift รอบใหม่:** ดูหัวข้อ "กระบวนการกัน Schema Drift" ใน `SOP.md` — สรุปสั้นๆ
คือ แก้ DB ตรงเมื่อไหร่ต้อง export กลับ repo วันเดียวกัน, seed ข้อมูลอ้างอิงกันด้วยชื่อไม่ใช่ raw id,
รัน fresh-install test ก่อนปิดงานที่แตะ schema, migration ใหม่ต้อง idempotent เสมอ

### 17. คืนวันที่ 21 ก.ค. 2026 — งาน QA อัตโนมัติภาคกลางคืน (nightly automated run #2)

ทำงานบน sandbox เดียวกับรอบก่อนหน้า (ไม่มี network ออก `*.supabase.co` — qa-tests ทั้งหมด mock
network ตามที่ `qa-tests/_fixtures/mockAuth.js` อธิบายไว้ แต่มี Supabase MCP ต่อ staging project
จริงได้ ใช้ตรวจ/แก้ schema สด + verify ด้วย SQL จริงก่อน export กลับเป็นไฟล์ migration) หยิบการ์ด
priority สูงสุดที่ยังไม่เสร็จมาทำทีละใบ ทั้งการ์ดโค้ดและการ์ดเอกสาร:

**ฟีเจอร์ใหม่/แก้ไข:**
- **Zone QR redesign + สแกนตำแหน่งตรงจากฟอร์ม** (`components/ZoneQRScanner.js`) — ตัวหนังสือบนป้าย
  QR โซนใหญ่ขึ้น (10pt→20pt) อ่านง่ายจากระยะยืนหน้าชั้นจริง + ปุ่ม "📷 สแกนตำแหน่งแทน" ในหน้า
  `/add` และ `/edit/[id]` เปิดกล้อง (native `BarcodeDetector` API) สแกน QR โซนแล้ว auto-fill
  ให้เลย ปฏิเสธ auto-fill ถ้าสแกนโซนที่ไม่ใช่ leaf
- **Job Assignment Status Tracking** (`app/jobs/[id]/page.js`) — ขั้นตอนงานย่อยแต่ละอันมีปุ่ม
  เริ่มงาน/หยุดชั่วคราว (บังคับกรอกเหตุผล)/ทำต่อ/เสร็จงาน แทน `<select>` เดิมที่ตั้งสถานะอะไรก็ได้
  ไม่มีลำดับ ไม่บันทึกเวลา — ตอนนี้บันทึก `started_at`/`completed_at` อัตโนมัติ + จำกัดสิทธิ์กดปุ่ม
  เฉพาะคนที่ถูก assign หรือ supervisor ขึ้นไป บังคับทั้ง UI และ DB trigger
- **ขยาย audit trail ไปที่ `parts`** (`components/PartAuditHistory.js`) — ปุ่ม "🕘 ประวัติการแก้ไข"
  ที่หน้า `/edit/[id]` เห็นได้ทุก role ที่แก้ไขอะไหล่ได้ ไม่ใช่แค่ owner/manager (ผ่าน RPC
  `get_part_audit_history` ที่เปิดให้ดูเฉพาะประวัติของชิ้นที่กำลังดูอยู่ ไม่ใช่ log เต็มร้าน)
- **Bulk เข้า shelf ให้อะไหล่เก่าที่ไม่มี `zone_id`** — เพิ่ม source mode ใหม่ที่ `/move-parts`
- **Part QR label spec** — เปลี่ยนจาก A4 grid (ใช้งานหน้างานจริงไม่ได้) เป็น 40x60mm เหมือน
  Zone QR + โซนที่โชว์อ่านจาก `zone_id` breadcrumb จริงแทน `zone_code` เดิมที่ไม่อัปเดตแล้ว
- **Zone move action + owner_type override** (`/move-part/[id]`) — action ย้าย Zone ทีละชิ้น
  แยกจากการแก้ `zone_id` ตรงๆ ในฟอร์มแก้ไข เช็ค `owner_type` ปลายทางกับปัจจุบัน ถ้าไม่ตรงมี
  checkbox ให้ยืนยันว่ายังเป็นประเภทเดิม + toggle ระดับร้าน "บังคับสแกน QR ยืนยันตำแหน่ง" ที่
  `/admin` (default ปิด)
- **กลไก ToS consent** (`components/TosConsentGate.js`) — ครอบทุกหน้าที่ผ่าน `RequireAuth`
  บล็อกการใช้งานจนกว่า owner จะกดยอมรับเงื่อนไขเวอร์ชันล่าสุด (role อื่นเห็น gate เหมือนกันแต่กด
  ยอมรับแทนไม่ได้) — เนื้อหาสัญญาใน `config/tosContent.js` เป็น **ร่างที่ยังไม่ผ่าน legal review**
  ตามที่การ์ดต้นทางระบุไว้ตรงๆ ว่าต้องมีคนตรวจสอบก่อนใช้งานจริง
- **`payment_method` บนฟอร์มขายทีละชิ้นที่มีอยู่แล้ว** (`/edit/[id]`) — บังคับเลือกทุกครั้ง
  (เงินสด/โอนเงิน/บัตร/อื่นๆ) ไม่ default เงียบๆ — ยังไม่แตะ cart-based selling flow ที่ยังไม่เริ่ม
- **Salvage Vehicle Intake** (`/salvage-vehicles`, `/salvage-vehicles/new`, `/salvage-vehicles/[id]`)
  — เฉพาะครึ่ง "รับซากรถเข้าระบบ" ของการ์ด ไม่รวม cost allocation (rounding rule ยังไม่ตัดสินใจใน
  การ์ด) ถ่ายรูป/เลือกรถ/ราคาซื้อ/โซนจอด/แตกมูลค่าประเมิน 4-6 กลุ่มบังคับ — `/add?salvage_vehicle_id=X`
  ทำงานเหมือน `?job_id=X` เดิม สถานะเปลี่ยนเป็น "กำลังถอด" อัตโนมัติเมื่อถอดชิ้นแรก (DB trigger)
- **Field Scanner role ใช้งานได้จริงแล้ว** — สร้างบัญชีผ่าน `/admin/team` ได้ (username+PIN + ตั้ง
  วันหมดอายุได้), เข้า `/add`/`/edit/[id]` ได้เต็มที่แต่ขายไม่ได้ (ซ่อน UI + RLS กันไว้ที่ DB),
  บัญชีหมดอายุ (`shop_members.expires_at`) ถูกปฏิเสธตอน login พร้อมข้อความชัดเจน — ยังไม่รวม
  Onboarding Burst Mode เต็มรูป (20 บัญชี/requester-approver/notification) หรือ scheduled job
  ตัด session ที่ active อยู่ตอนหมดอายุจริง (กลไก cron ยังไม่ตัดสินใจ)
- **นำเข้าข้อมูลลูกค้าเดิมจาก CSV** (`/admin/import-customers`, owner/manager เท่านั้น) — เพิ่ม
  CSV parser ใหม่ (`lib/csvImport.js` — โปรเจกต์เดิมมีแต่ฝั่ง export) upload → เดา column mapping
  อัตโนมัติ → พรีวิว validate ทีละแถว → ยืนยัน เบอร์โทรที่ซ้ำกับลูกค้าเดิมในระบบจะถูกข้าม (ไม่ทับ)

**Schema drift ที่แก้ (พบอีกหลายจุดคืนนี้ — pattern เดิมซ้ำ: DB จริงบน staging นำหน้าไฟล์ใน git):**
- `db/job_assignment_status_tracking_migration.sql` — `job_workflow_steps.hold_reason`/`held_at`,
  `on_hold` status, และ trigger บังคับลำดับ state machine + สิทธิ์ (`enforce_workflow_step_status_transition`,
  `update_job_workflow_step_timestamps`) มีอยู่แล้วบน staging จากเซสชันก่อนหน้าที่การ์ดถูก mark
  "In progress" แต่ไม่เคย commit
- `db/audit_log_full_coverage_migration.sql` — **ที่ใหญ่สุดคืนนี้:** พบว่ามี generic trigger
  function `fn_audit_row_change()` ครอบ `parts`/`jobs`/`shop_members`/`shops`/`options`/`zones`
  อยู่แล้วจริงบน staging จากเซสชันก่อนหน้า (การ์ด "ขยาย audit_log ให้ครอบทั้งระบบ" เกือบเสร็จไปแล้ว
  ก่อนเราเริ่มทำด้วยซ้ำ) — ไฟล์นี้ยังแก้ **regression ที่เราทำเองในเซสชันนี้เอง** ด้วย: ตอนแรกไม่รู้
  เรื่อง generic trigger เลยสร้างฟังก์ชันเฉพาะ `parts` แยกของตัวเอง ทำให้ `parts` หลุดออกจาก
  pattern กลาง แก้คืนแล้วในไฟล์นี้ (verify ด้วยการรัน UPDATE จริงบน staging เช็คว่า log ขึ้นถูก)
- `db/zone_move_action_migration.sql` — `shops.force_zone_scan_confirmation`,
  `parts.owner_type_override` (คอลัมน์ใหม่จริง ไม่ใช่ drift — เพิ่มจากการ์ด "ย้ายอะไหล่ระหว่าง Zone")
- ยืนยันอีกครั้งว่า `zones.path` เป็น PostgreSQL `ltree` จริง (ไม่ใช่ text) พร้อม trigger
  auto-maintain path (`trg_zones_set_path`/`trg_zones_update_path`) อยู่แล้วบน staging — การ์ด
  "Area/Rack/Level location hierarchy (ltree)" เกือบเสร็จไปแล้วเช่นกัน (ไม่ได้แตะเพิ่มคืนนี้
  เพราะเวลาไม่พอตรวจ data migration ของ `zone_code` เก่าที่การ์ดต้องการให้ครบ)
- `db/salvage_vehicle_intake_migration.sql` — ตารางใหม่จริง (ไม่ใช่ drift)
- `db/field_scanner_role_migration.sql` — บทบาท `field_scanner` มีอยู่แล้วจริงใน
  `shop_members_role_check` และ RLS ของ `parts`/`zones` (ครอบไว้แล้ว) และ `customers`/`part_sales`
  (ตั้งใจไม่รวมไว้ถูกต้องแล้วตามการ์ด) จากเซสชันก่อนหน้า แต่**แอปไม่รู้จัก role นี้เลยสักที่เดียว** —
  `shop_members.expires_at` เป็นคอลัมน์ใหม่จริง (ไม่ใช่ drift)
- `db/import_customers_migration.sql` — ต่อ `customers` เข้า `fn_audit_row_change()` (คอลัมน์/ตาราง
  ใหม่จริง ไม่ใช่ drift)

**เอกสารที่แก้ไข (พบข้อมูลเก่าที่ไม่ตรงกับโค้ดจริงแล้ว 3 จุด):** `SOP.md` เคยบอกว่าสแกน QR ยังไม่มี
และ Platform Admin Activity Log ยังไม่มี UI (ทั้งคู่มีแล้วจริง) และทั้ง `SOP.md`+`USER_MANUAL.md`
เคยบอกว่า `USER_MANUAL.md` ยังเป็น draft ไม่มีไฟล์ (มีไฟล์อยู่แล้วจริงตั้งแต่คืนก่อน) — แก้ครบแล้ว
พร้อมเพิ่มเนื้อหาฟีเจอร์ใหม่คืนนี้ (Job Assignment Status Tracking, parts audit history)

**การ์ดที่ตัดสินใจไม่ทำคืนนี้ (ตัวการ์ดเองเตือนว่าเสี่ยงถ้าทำแยก):** "ระบบเอกสาร/ใบเสร็จแยกสำหรับ
ขายอะไหล่" และส่วนที่เหลือของ "บันทึกวิธีชำระเงิน" (checkout เต็มรูป) — ทั้งคู่ผูกกับ Cart-based
selling flow ที่ยังไม่เริ่ม การ์ดต้นทางเตือนตรงๆ ว่าทำแยกกันเสี่ยงได้ checkout ที่ขาดช่องสำคัญ
ไม่ได้ implement ในช่วงเวลานี้เพื่อไม่ให้ต้องรื้อทำใหม่ตอน cart flow เริ่มจริง

**⚠️ GitHub push ไม่สำเร็จคืนนี้:** sandbox มี read access clone `staging` ได้ปกติ แต่ push ถูก
ปฏิเสธ (403) ทุกครั้ง — commit ทั้งหมดของคืนนี้จึงอยู่ใน local git history ของ sandbox เท่านั้น
ยังไม่ขึ้น GitHub จริง คุณอั้มต้องดึง patch/diff ไปใส่ที่ repo จริงเอง (ดูสรุปท้ายเซสชัน)

### 18. ดึกคืนเดียวกัน 21 ก.ค. 2026 — งาน QA อัตโนมัติภาคกลางคืน (nightly automated run #3)

ทำงานบน sandbox ใหม่ (clone `staging` จาก GitHub สดๆ — พบว่า commit ของ run #2 ขึ้น GitHub จริง
แล้วทั้งที่ log ของ run #2 บอกว่า push ไม่สำเร็จ คาดว่า push สำเร็จภายหลังจากช่องทางอื่น) หยิบการ์ด
priority สูงสุดที่ยังไม่เสร็จมาทำต่อทีละใบ ทั้งการ์ดโค้ดและการ์ดเอกสาร ตามลำดับที่ยังไม่เสร็จจากรอบก่อน:

**ฟีเจอร์ใหม่/แก้ไข:**
- **Cart-based selling flow** (`app/checkout/page.js`) — เพิ่มโหมด "🛒 เลือกขาย" คู่กับ "เลือกพิมพ์ QR"
  เดิมที่หน้ารายการอะไหล่ เลือกได้หลายชิ้นข้ามหน้า → `/checkout` แก้จำนวน/ราคาต่อชิ้น + ผู้ซื้อ +
  วิธีชำระเงิน (บังคับเลือก) → ยืนยันขายทั้งหมดตัดสต็อกทีละชิ้นแบบเป็นอิสระต่อกัน (ชิ้นที่ fail ไม่
  rollback ชิ้นที่สำเร็จแล้ว) → Picking List (มีปุ่ม "หาไม่เจอ" คืนสต็อกอัตโนมัติ) → Confirm Pick
  แบบ walk-in ออกใบเสร็จให้อัตโนมัติ ทำพร้อมกับ 2 การ์ดที่ผูกกัน (payment_method ต่อเข้า checkout,
  part_sale_documents แบบ receipt-only) ตามที่การ์ดต้นทางกำหนดไว้ว่าต้องทำพร้อมกัน — ไม่ทำ
  tax_invoice/pack-ship เต็มรูป/branch transfer อัตโนมัติรอบนี้ (ดูรายละเอียด scope ที่ตั้งใจตัดใน
  `db/cart_based_selling_flow_migration.sql`)
- **Area/Rack/Level location hierarchy** — พบว่าโครงสร้าง ltree เกือบทั้งหมด (parent_id/path/
  trigger รักษา path+กันวงจร/unique code ต่อ parent/`parts.zone_id`) live บน staging จริงจาก
  เซสชันก่อนแต่ไม่เคยมีไฟล์ migration เลย export กลับเป็น `db/zone_hierarchy_ltree_migration.sql`
  แล้ว ระหว่างตรวจพบช่องโหว่ multi-tenant จริง (parent_id ข้ามร้านไม่ถูกกัน) แก้เป็น trigger ใหม่
  ในไฟล์เดียวกัน พร้อมเขียน data migration script zone_code (เก่า) → zone_id ที่การ์ดต้องการแต่
  ยังไม่เคยมีใครเขียน
- **บั๊กที่แก้:** `/admin/zones` เดิมบล็อกลบโซนถ้ามีอะไหล่ผูกอยู่ แม้ quantity=0 (ขายหมดแล้ว) แล้ว —
  ขัดกับมติการ์ดที่ตัดสินใจว่านับเฉพาะ quantity > 0 แก้แล้ว

**เอกสารที่แก้ไข (พบข้อมูลเก่าที่ไม่ตรงกับโค้ดจริงแล้วหลายจุดใน `SOP.md`):** section 2 (bulk-assign
โซนเก่าที่บอกว่า "รอสร้าง" ทั้งที่ทำเสร็จแล้ว), section 3-5 (ขายอะไหล่/รับชำระเงิน/ใบเสร็จ อัปเดต
ทั้งหมดให้ตรงกับ cart flow ใหม่คืนนี้), section 6 (prerequisite ของ Accounting Module เสร็จครบทั้ง
2 ตัวแล้วแต่เอกสารเก่ายังบอกว่ายังไม่เริ่มทั้งคู่), section 7 (Salvage Vehicle Intake บอกว่า "ยังไม่มี
เลย" ทั้งที่ทำเสร็จไปแล้วตั้งแต่คืนก่อน), toggle "บังคับสแกน QR" ในหัวข้อ 1 บอกว่ายังไม่ได้ทำทั้งที่
ทำเสร็จไปแล้ว — `USER_MANUAL.md` ก็แก้ 1 จุด (audit trail บอกว่ายังไม่ครอบ jobs/shop_members/
shops/options/zones ทั้งที่ตรวจ DB จริงพบว่าครอบครบ 8 ตารางแล้ว) และเพิ่มคอลัมน์ "ขายอะไหล่" ใน
ตารางสิทธิ์บทบาทที่ขาดไปหลังเพิ่ม permission `sell_parts` ใหม่

**Schema drift ที่แก้:** ดูหัวข้อฟีเจอร์ด้านบน (zone hierarchy ltree) — เพิ่มเข้า
`db/zone_hierarchy_ltree_migration.sql`, `db/cart_based_selling_flow_migration.sql` (ตารางใหม่จริง
ไม่ใช่ drift)

**เทส:** unit test ใหม่ 1 ไฟล์ (zoneHelpers, 17 checks) + Playwright ใหม่ 2 ไฟล์ (zone delete-block
3 scenario, cart checkout 7 scenario) ทุกไฟล์ผ่านตั้งแต่รอบแรกที่รัน (ไม่มีรอบแก้บั๊ก) — full suite
71/71 ผ่าน ไม่มี regression กับของเดิม

**ทำต่อในเซสชันเดียวกัน (ยังคืนวันที่ 21 ก.ค.):**
- **Onboarding Burst Mode** — จำกัด field_scanner ชั่วคราวสูงสุด 20 บัญชี/ร้าน แยกจาก seat limit
  ปกติ, แก้บั๊กจริงที่เจอ (`lib/sessionTracking.js` เดิมนับ field_scanner รวมกับ concurrent cap
  ปกติทุก role เหมือนกัน ทั้งที่ตัดสินใจไว้ว่าไม่ควรนับ), extension workflow Manager
  ขอ/Owner อนุมัติ บังคับที่ API จริงไม่ใช่แค่ UI — มี ❓ ที่การ์ดเองยังไม่ตัดสินใจ 4 จุด ใช้ assumption
  ที่ระบุชัดแทนการเดาเงียบๆ (ดู `db/onboarding_burst_mode_migration.sql`)
- **Concurrent session limit** — แก้บั๊กจริงที่การ์ดชี้ไว้ตรงๆ (JWT ของเครื่องที่ถูก evict ยังใช้ได้
  ต่อจนหมดอายุเอง ไม่ได้ตัดสิทธิ์ทันที) ด้วยวิธี heartbeat-based detection แทน middleware ตามที่
  การ์ดตัดสินใจไว้ เพราะแอปนี้เป็น client-side SPA ล้วน Next.js middleware ดักการยิง REST ตรงจาก
  เบราว์เซอร์ไปที่ Supabase ไม่ได้เลย
- **Stock Value Cap Engine** — running counter + state machine (under→grace→blocked) ครบใน DB,
  banner แจ้งเตือน + บล็อกสร้างงานใหม่ตอน blocked — สูตรต้นทุนยังนับแค่ price×quantity ตรงๆ
  (รอ Salvage cost allocation ก่อนถึงจะรวม allocated_cost ได้)
- **Field Visibility Whitelist กลาง** — `config/fieldVisibility.js` + override table พร้อม floor
  rules บังคับซ้ำที่ DB layer, wire เข้า Export CSV แล้ว (1 ใน 4 การ์ดที่ควรใช้ — อีก 3 ยัง Not
  started/ใช้ config เดิม)
- **Informal Report (ส่วนย่อยของ Accounting Module)** — เพิ่มแยกตามวิธีชำระเงินที่
  `/admin/reports`, แก้บั๊กที่เจอ (query เดิมนับรวมรายการที่ถูก mark "หาไม่เจอ" ตอน pick เป็นยอดขาย
  ทั้งที่คืนสต็อกไปแล้ว)
- **Write-off** (edge case 1 ของ Salvage cost allocation) — ปุ่ม "ตัดเป็นค่าเสียหาย" เป็น generic
  action บนอะไหล่ตัวไหนก็ได้ที่ `/edit/[id]` แยกจาก "ซ่อนอะไหล่" เดิม

**🔒 บั๊กความปลอดภัย/ความถูกต้องที่เจอจากการตรวจ RLS แบบจำลอง role จริงท้ายเซสชัน (สำคัญ):**
ปกติแล้ว qa-tests ทั้งชุด mock network ทั้งหมด ไม่เคยชน RLS จริงเลย และการรัน SQL ผ่าน Supabase MCP
ก็ใช้สิทธิ์ที่ bypass RLS ด้วย — ท้ายเซสชันนี้เปลี่ยนมาจำลอง `set local role authenticated` +
JWT claim จริงตรงกับที่ PostgREST ใช้ (ไม่ใช่แค่รันผ่าน MCP เฉยๆ) พบบั๊กจริง 3 จุดที่ไม่มีทางเจอได้
จาก Playwright เลย:
1. `restore_part_stock` (RPC ใหม่คืนนี้) ไม่มีการเช็คสิทธิ์เลย — user คนไหนก็ได้เพิ่ม quantity ให้
   part_id ของร้านอื่นได้โดยตรง — แก้แล้ว
2. `part_sales` ไม่เคยมี UPDATE policy เลยตั้งแต่ก่อนคืนนี้ — Confirm Pick/ปุ่ม "หาไม่เจอ" ของ
   Cart-based selling flow ที่ต้อง UPDATE item_status จะโดน RLS บล็อกเงียบๆ จริงใน production
   (0 แถวถูกแก้ ไม่มี error) — แก้แล้ว
3. Stock Value Cap Engine trigger ไม่ได้เป็น SECURITY DEFINER — `shops` UPDATE RLS อนุญาตแค่
   owner/manager แต่ trigger นี้ทำงานทุกครั้งที่ใครก็ตามแก้ `parts` (รวม supervisor/technician/
   assistant ที่แก้อะไหล่ตลอดเวลา) — ถ้าไม่แก้ counter จะไม่อัปเดตเลยเมื่อคนที่ไม่ใช่ owner/manager
   เป็นคนแก้ ซึ่งเป็นเคสส่วนใหญ่ของการใช้งานจริง — แก้แล้ว

ทั้ง 3 จุด verify ด้วยการจำลอง role จริงตรงกับ staging แล้วว่าแก้ถูกต้อง (ไม่ใช่แค่ "compile ผ่าน")

**การ์ดที่ประเมินแล้วไม่ทำ (บล็อกจริง ไม่ใช่แค่เวลาไม่พอ):**
- Multi-branch support / API พื้นฐาน — การ์ดเองตัดสินใจ "เลื่อนได้จนกว่าจะมีลูกค้าจริงร้องขอ"
- Platform Revenue Module — commission ครึ่งหนึ่งรอ marketplace feature ที่ยังไม่มี, subscription
  revenue อีกครึ่งพบว่าโปรเจกต์นี้ไม่มีระบบรับชำระเงินจริงเลยแม้แต่จุดเดียวให้ผูก revenue event ด้วย
- Custom Report Builder — ราคา add-on ยังไม่ตกลง (การ์ดเองบอกว่า "เดี๋ยวคุยแยกต่างหาก") + ไม่มีระบบ
  license/entitlement ให้ผูกจริง
- โอนอะไหล่ข้ามสาขา / ขายอะไหล่ที่ยังไม่ตีราคา — บล็อกด้วย ❓ ที่ยังไม่ตัดสินใจหลายจุด หรือรอการ์ด
  ต้นทาง (Multi-branch, Salvage cost allocation) ที่ยังไม่พร้อม

**⚠️ GitHub push ไม่สำเร็จคืนนี้เช่นกัน** (403 เหมือนทุกรอบก่อนหน้า) — commit ทั้งหมด (12 commits)
อยู่ใน local git history ของ sandbox เท่านั้น

ดูสรุปเวลาที่ใช้ + การ์ดที่ทำ/ยังไม่ทำ แบบละเอียดท้ายเซสชันนี้ (ส่งให้คุณอั้มโดยตรงผ่าน Notion comment
ของแต่ละการ์ด + สรุปในแชท)
