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

### ส่วนเพิ่มเติม — real E2E test suite (`qa-automation/`) ตามคำขอของคุณอั้ม (session แยกต่างหาก)

คุณอั้มขอ Playwright test สำหรับทดสอบ staging จริง (ไม่ mock เครือข่ายเหมือน `qa-tests/` ที่ต้องรันใน
sandbox เพราะออกเน็ตไม่ได้) ทั้ง regression set เดิมและฟีเจอร์ใหม่ทั้งหมดของคืนวันที่ 21 ก.ค. 2026 —
พบว่าไดเรกทอรี `qa-automation/` มีอยู่แล้วจริงบน branch `main` (จากงาน migration multi-tenant ก่อนหน้า)
แต่ไม่เคย merge เข้า `staging` เลย จึง port เข้ามาแล้วขยายให้ครอบคลุมฟีเจอร์ใหม่ 13 การ์ดที่ทำในรอบ
nightly QA คืนนั้นโดยเฉพาะ (TOS/JOBSTAT/AUDIT/MOVEPARTS/MOVEPART/PAYMENT/SALVAGE/FIELDSCAN/IMPORT/
LABEL — 46 test ใหม่ รวมกับของเดิม 95 test เป็น 141 test ใน 28 ไฟล์) พร้อมแก้ compatibility ให้เข้ากับ
ToS gate ที่เพิ่งเพิ่มเข้ามาคืนนั้น (สำคัญสุด: seed `shop_tos_acceptances` ให้ทุก test shop ล่วงหน้าใน
`setup-test-data.mjs` กัน gate บล็อก suite เดิมทั้งหมด) — รายละเอียดเต็มอยู่ใน `qa-automation/README.md`
หัวข้อ "คืนวันที่ 21 ก.ค. 2026"

**⚠️ หมายเหตุสำคัญ:** ชุด `qa-automation/` นี้ **ยังไม่ครอบคลุมการ์ดที่ทำเพิ่มเติมหลังจากนั้น** ในเซสชัน
ที่ต่อยอดมา (Cart-based selling flow, Field Visibility Whitelist, Stock Value Cap Engine, Onboarding
Burst Mode, Write-off, Sales report payment_method breakdown, และ RLS bug fix ทั้ง 2 จุด) — เขียนขึ้น
ก่อนที่งานเหล่านั้นจะเสร็จ ยังต้องเพิ่ม test สำหรับการ์ดกลุ่มนี้ต่อในรอบถัดไปถ้าต้องการให้ครอบคลุมครบ

**เจอบั๊ก path ผิดในไฟล์เดิมจาก `main`:** `tests/job-creation-photos.spec.js` ชี้ path รูปทดสอบผิดที่
(`tests/test-assets/` แทนที่จะเป็น `fixtures/test-assets/`) ทำให้ JOB-501–503 พังทันทีถ้ารันจริง —
แก้แล้ว ไม่เกี่ยวกับฟีเจอร์คืนนี้ เป็นบั๊กเดิมที่ค้างมาจาก `main`

**เจอ known gap:** RPC `get_part_audit_history()` ไม่รวม `field_scanner` ในรายชื่อ role ที่อนุญาต
ทั้งที่ field_scanner แก้ไข part ได้จริง — แก้ไขอะไหล่ได้แต่ดูประวัติการแก้ไขของชิ้นนั้นไม่ได้ ยังไม่ได้
แก้ (แค่ flag ไว้ใน test AUDIT-005 ให้ทีม dev ตัดสินใจ)

⚠️ **ชุด test ใหม่ (`card-*.spec.js`) เขียนจากการอ่านโค้ด/schema/RLS จริงเท่านั้น ยังไม่เคยรันจริงสักครั้ง**
เพราะ sandbox ที่เขียนไม่มี network ออก `*.supabase.co`/`*.vercel.app` — ผ่านแค่
`npx playwright test --list` (parse/load สำเร็จหมด 141 test) คุณอั้มต้องรันจริงจากเครื่อง/CI ก่อนเชื่อ
ผลได้เต็มที่ (ดู Quick Start ใน `qa-automation/README.md`)

### 19. คืนวันที่ 22 ก.ค. 2026 — งาน QA อัตโนมัติภาคกลางคืน (nightly automated run #4)

Sandbox รอบนี้เข้า `*.vercel.app`/`*.supabase.co` ตรงไม่ได้เหมือนเดิม (มีแค่ github.com/npm ผ่าน
allowlist) — Playwright ยังใช้ได้ปกติแต่รันชน staging จริงไม่ได้ จึงเลือกการ์ดที่ verify ได้โดยไม่ต้องพึ่ง
browser E2E ทั้งหมด 8 การ์ด (5 โค้ด, 1 QA-test fix, 2 เอกสาร/verification) — ทุกจุดที่แตะ DB จริง
verify ผ่าน Supabase MCP โดยจำลอง role จริง (`set local role authenticated` + `request.jwt.claims`)
ก่อนเชื่อ ไม่ใช่แค่ "compile ผ่าน" — รายละเอียดเต็มอยู่ในคอมเมนต์ Notion ของแต่ละการ์ด สรุปย่อด้านล่าง:

**🔴 การ์ดโค้ด — P0 Security: `platform_add_admin`/`change_admin_role`/`remove_admin` ไม่เช็คสิทธิ์จริง:**
- ฟังก์ชันทั้ง 3 (ตามการ์ด) เชื่อพารามิเตอร์ `p_actor_role` ที่ผู้เรียกส่งมาเองล้วนๆ ไม่เคยเช็คจาก DB เลย
  — ใครเรียก RPC ตรงได้ (ข้าม Next.js app) ยกระดับตัวเองเป็น super_admin ได้ทันที
- **ขยายขอบเขตเกินการ์ด:** พบว่า `platform_join_as_support`/`platform_update_shop_subscription` มี
  ช่องโหว่แบบเดียวกันทุกประการ และ (ต่างจาก 3 ตัวแรก) ยังไม่เคย revoke execute จาก anon/authenticated
  ฉุกเฉินเลย — ยัง exploit ได้จริงตอนตรวจ 22 ก.ค. จึงแก้พร้อมกันทั้ง 5 ฟังก์ชัน
- แก้โดยให้ฟังก์ชัน lookup role จริงจาก `platform_admins` ด้วย `p_actor_user_id` แทนพารามิเตอร์ role
  ที่รับมา (ตัดออกจาก signature ทั้งหมด) + เช็ค `auth.uid()` คู่เป็น defense-in-depth + revoke execute
  จาก anon/authenticated/PUBLIC แบบถาวรทั้ง 5 ฟังก์ชัน (`db/platform_admin_rpc_auth_check_migration.sql`)
- **บั๊กแยกที่พบระหว่างทดสอบ:** `platform_audit_log.action` CHECK constraint ไม่ตรงกับ action string
  ที่ 4 ใน 5 ฟังก์ชันเดิม insert (ตรงแค่ `join_as_support`) — แปลว่า add/remove/change-role admin และ
  update subscription **error 500 ทุกครั้งที่เรียกจริงมาโดยตลอด** (audit log insert ไม่ผ่าน constraint
  → rollback ทั้ง transaction) แก้ให้ตรงกับ constraint ในไฟล์เดียวกัน
- Apply แล้วบน staging Supabase project จริง (`qmqabtrrubqcmafietsr`) ผ่าน MCP — verify ด้วยการจำลอง
  attack 3 แบบ (analyst self-escalate, unknown-uuid actor, analyst join-as-support) ทั้งหมดถูกบล็อก
  + flow ปกติของ super_admin จริงยังทำงานถูกต้อง + `get_advisors(security)` ไม่มี warning เหลือ — ไม่มี
  Playwright test scenario กำหนดไว้ในการ์ดนี้ (security fix ไม่ใช่ UI feature) จึง verify ที่ระดับ
  SQL/RPC contract แทน
- **⚠️ ผลกระทบชั่วคราว:** DB signature เปลี่ยนแล้วจริงบน staging แต่ route.js บน Vercel ยังเป็นโค้ดเก่า
  (ยังไม่ได้ deploy) → `platform_join_as_support` จะ error จนกว่าจะ deploy โค้ดใหม่ — ยอมรับได้เพราะ
  ฟีเจอร์นี้ยัง WIP บน staging เท่านั้น ไม่มีใน beta/production

**📄 การ์ดเอกสาร — cross-check `SOP.md` กับโค้ด/DB จริง:**
- ตรวจ section 3 (cart checkout ออกใบเสร็จอัตโนมัติ), section 8 (platform admin role tiers), section 9
  (job workflow permission), zone hierarchy cross-tenant trigger — ส่วนใหญ่ตรงกับโค้ดจริง
- พบ 1 จุดไม่ตรง: section 8 บอกว่า platform admin "ใช้งานได้จริง" แต่ไม่ได้บอกว่า add/remove/
  change-role admin ที่จริงแล้ว error 500 มาตลอด (บั๊กเดียวกับที่เจอตอนแก้การ์ดโค้ดข้างต้น) — เพิ่ม
  หมายเหตุแก้ไขในเอกสารแล้ว พร้อมอ้างอิงว่าแก้ที่ไหน
- Section อื่นที่เช็ค (Accounting Module, ขายของยังไม่ตีราคา, salvage cost allocation) ยังตรงกับ "ยังไม่ทำ"
  ตามเดิม ไม่มี drift

**✅ การ์ดโค้ด — ToS consent:** ตรวจสอบเท่านั้น ไม่ได้แก้อะไร — code+schema+เนื้อหาสัญญาร่างครบแล้วจริง
(ยืนยันจาก staging DB: มีร้านจริงยอมรับเวอร์ชันปัจจุบันแล้วหลายร้าน) เหลือแค่ส่วนที่ automation ทำแทน
ไม่ได้ (ให้ทนายจริง review ร่างสัญญา) — ไม่ใช่ gap ของโค้ด

**✅ การ์ดโค้ด — Salvage vehicle cost allocation (relative sales value method):** มติทั้งหมด
(rounding, freeze, sold_whole restriction, เศษเหล็ก) เคาะไว้ครบตั้งแต่ 21 ก.ค. แต่ยังไม่เคย implement —
คืนนี้ทำครบ: `parts.estimated_value`/`allocated_cost` (คอลัมน์หลังไม่เคยมีอยู่จริงมาก่อนทั้งที่ถูกอ้างถึง
ในคอมเมนต์ของการ์ดอื่น — เจอระหว่างทดสอบ), trigger คำนวณอัตโนมัติ, freeze/guard trigger, RPC
`sell_salvage_vehicle_scrap`, RLS floor ตาม RBAC matrix, ปุ่ม UI ที่ `/add` และหน้ารายละเอียดรถ —
verify ผ่าน Supabase MCP ครบทุกจุด (สัดส่วน, freeze, guard, RBAC, Σ allocated_cost = purchase_price)
ผ่านหมดในรอบแรก + revoke การเปิด RPC โดยไม่ตั้งใจของ trigger function 2 ตัว (1 ตัวใหม่คืนนี้ + 1 ตัวเดิม
จาก intake migration ที่เจอพร้อมกัน)

**✅ การ์ดโค้ด — Onboarding Burst Mode:** เติม 2 ช่องว่างระหว่างมติ 21 ก.ค. กับโค้ดเดิม (ที่บันทึกไว้ตรงๆ
ว่ายังไม่ implement เพราะเขียนก่อนมติจะเคาะ) — cap 20 บัญชี configurable ต่อ tier (Enterprise = ไม่จำกัด)
ย้ายเข้า `config/subscriptionTiers.js`, Platform Admin (super_admin/support) กดอนุมัติ/ปฏิเสธคำขอต่ออายุ
แทน Owner ได้ถ้า Owner ไม่ตอบ พร้อมลง platform_audit_log ชัดเจนว่าเป็น override — เจอ+ป้องกันบั๊กคลาส
เดียวกับ P0 security ล่วงหน้า (เพิ่ม action ใหม่เข้า CHECK constraint ตั้งแต่แรก แทนที่จะลืมแบบ 4 ฟังก์ชัน
ก่อนหน้า)

**✅ การ์ดโค้ด — Export CSV เพิ่ม Jobs + Sales:** เดิมมีแค่ Parts (คอมเมนต์บอกตรงๆ ว่าเลื่อน Jobs/Sales
ไว้เพราะ payment_method/cart flow ยังไม่มี — ตอนนี้มีแล้ว) เพิ่ม `/api/jobs/export-csv`,
`/api/sales/export-csv`, เพิ่มคอลัมน์ `allocated_cost` ใน Parts export — ตรวจ column/table name ทุกจุด
กับ schema จริงผ่าน Supabase MCP แล้ว

**✅ การ์ดโค้ด — Stock Value Cap Engine:** ปลดล็อกสูตรต้นทุนที่ค้างไว้ตั้งแต่การ์ดนี้ทำครั้งแรก
(price×quantity เพราะตอนนั้น allocated_cost ยังไม่มี) เปลี่ยนเป็น `coalesce(allocated_cost, price, 0)
× quantity` แล้ว recompute ทุกร้าน — verify แล้วว่าไม่กระทบร้านที่มีอยู่จริงเลย (ยังไม่มี salvage part
จริง) และคำนวณถูกต้องเมื่อมี allocated_cost (จำลองทดสอบแล้ว)

**สถานะการ์ดที่ตรวจแล้วแต่ไม่ได้แตะ (ใหญ่เกินไป/ยังมีคำถามค้างที่ต้องให้คุณอั้มตัดสินใจ ไม่ใช่ automation
ตัดสินใจเอง):** Admin Role (7th role) — ขนาด L กระทบหลายจุดเกินไปสำหรับ sandbox ที่ verify แบบ live
ไม่ได้, "Salvage vehicle cost allocation edge cases" ส่วนที่เหลือ (NRV check ต้องรอ Accounting Module,
เกณฑ์ write-off approval ยังไม่ตัดสินใจ), "รองรับยี่ห้ออะไหล่ (Part Brand)" — การ์ดใหม่วันนี้เอง ระบุไว้
ตรงๆ ว่า "ต้องตัดสินใจก่อนเริ่ม implement" 2 ข้อ (ชื่อ item_type ใหม่, quantity semantics)

**⚠️ GitHub push ไม่สำเร็จอีกครั้ง** (403 — sandbox อัตโนมัตินี้มีแค่สิทธิ์ read บน repo เหมือนทุกรอบก่อน
หน้า) — commit ทั้งหมด (9 commits คืนนี้) อยู่ใน local git history ของ sandbox เท่านั้น มี patch file
ให้คุณอั้ม apply เอง

---

### 20. คืนวันที่ 23 ก.ค. 2026 — Admin Role + Job Type Bundle Template + Platform Revenue Module

สามการ์ด "🔴 Highest" ที่ค้างอยู่บนบอร์ด ทำพร้อมกันตามลำดับ dependency: Admin Role ก่อน (เพราะ
Job Type Bundle Template ต้องพึ่ง role `admin` ที่ยังไม่มี) แล้วค่อย Platform Revenue Module
(อิสระจาก 2 การ์ดแรก) Branch: `feature/admin-role-7th-role` แตกจาก `staging` (ไม่ใช่ `main` —
`main` ตามหลัง `staging` 104 commits ขาด infra ที่ทั้ง 3 การ์ดต้องพึ่ง เช่น `platform_admins`,
field visibility whitelist) ทุกจุดที่แตะ DB จริง verify ผ่าน Supabase MCP บน staging
(`qmqabtrrubqcmafietsr`) รวมถึง round-trip test เต็มรูปของ Platform Revenue (record → recognize
→ reconcile → cleanup) ก่อนปิดงาน

**⚠️ แก้ไขสมมติฐานผิดของการ์ดเอง 2 จุด ระหว่างทำ:**
1. การ์ด Admin Role อ้างว่าจะ "reuse UI ของ Approval Flow ที่มีอยู่แล้ว" — ตรวจสอบด้วย grep
   ทั่วโปรเจกต์แล้ว **ไม่เคยมี Approval Flow (maker-checker) อยู่จริงเลยสักจุด** ต้องสร้างใหม่ทั้งระบบ
   (ตาราง `admin_action_approval_config`/`pending_admin_actions` + RPC
   `decide_pending_admin_action`) ทำให้การ์ดนี้ใหญ่กว่าที่ประเมินไว้เดิมมาก
2. แผนเดิมจะ wire `edit_part_cost` (1 ใน 12 default action_type) เป็นจุด enforce จริง — ตรวจโค้ด
   แล้วพบว่า**ไม่มีช่องแก้ราคาทุนของอะไหล่ที่มีอยู่แล้วในระบบเลย** (`allocated_cost` คำนวณจาก trigger
   อัตโนมัติ, `estimated_value` แก้ได้แค่ตอนสร้างใหม่และมี RLS floor อยู่แล้ว) เหลือแค่
   `import_customers` ที่เป็นจุด enforce จริงจุดเดียวรอบนี้ — อีก 11 action_type ตั้งค่าไว้ล่วงหน้าได้
   ที่หน้า settings แต่ยังไม่ enforce จนกว่าฟีเจอร์ต้นทางจะสร้างเสร็จ (ตรงกันข้ามกับสมมติฐานตอนแรก
   คือ card item (2) "จัดการเอกสาร/ใบเสร็จ" **ไม่ได้บล็อกด้วยการ์ดในอนาคต** — ตาราง
   `job_documents`/`part_sale_documents` มีอยู่แล้วจริงบน staging เพิ่ม `admin` เข้า RLS ได้เลย)

**✅ Admin Role (7th role) + Maker-Checker Approval Flow** (`db/admin_role_migration.sql`,
`db/admin_action_approval_migration.sql`):
- เพิ่ม `admin` เข้า role enum ของ `shop_members`/`shop_invites`/
  `shop_field_visibility_overrides` — floor rule "จัดการ API key" ล็อกไว้เหมือน role อื่นที่ไม่ใช่
  Owner/Manager
- RLS sweep ตาม rule of thumb "เท่า Supervisor บนตารางที่การ์ดให้สิทธิ์จริง": `parts`
  (insert/update/view + estimated_value floor), `customers`, `job_cost_items` (4 policy แยก
  view/insert/update/delete), `jobs` (view/insert/update — ไม่รวม delete), `shops`/
  `shop_members` (view), `shop_field_visibility_overrides` (view), `job_documents`/
  `part_sale_documents` (create/update/view), `part_sales` (record/update/view — ให้
  `sell_parts: true` ใน `config/rolePermissions.js` ใช้งานได้จริงไม่ใช่แค่ตั้งไว้เฉยๆ)
- `config/fieldVisibility.js`/`config/rolePermissions.js` เพิ่ม `admin` block (parity กับ
  supervisor) — Export CSV ได้ฟรีเพราะอ่านผ่าน matrix เดียวกันอยู่แล้ว
- UI: `app/admin/team/page.js` (invite/staff-creation dropdown), `app/admin/import-customers/
  page.js` (เพิ่ม admin เข้า allowedRoles — ตอบ RBAC ที่การ์ด Import ลูกค้าเดิมค้างไว้), และ
  RequireAuth allowedRoles ของหน้าที่ RLS granted แล้ว (`/add`, `/edit/[id]`, `/move-part(s)`,
  `/checkout`, `/jobs`, `/jobs/[id]`, `/jobs/new`, `/jobs/[id]/documents/[documentId]`)
- Approval Flow ใหม่: `config/adminApprovalDefaults.js` (default table + fallback helper —
  ร้านที่ไม่มี override แถวไหนเลยทำงานถูกต้อง 100% โดยไม่ต้องตั้งค่าอะไรก่อน), wire จริงที่
  `import_customers` confirm step, หน้าใหม่ `app/admin/settings/admin-approvals/page.js`
  (Owner/Manager ตั้งค่า) และ `app/admin/admin-approvals/page.js` (คิวรออนุมัติ) — เมนูทั้งคู่แสดง
  เฉพาะร้านที่มี Admin จริงอย่างน้อย 1 คน (เพิ่ม `shopHasAdminMember` ใหม่ใน
  `lib/AuthProvider.js` — pattern เดียวกับที่ `stock_cap_status` ใช้อยู่แล้ว)

**✅ Job Type Bundle Template** (`db/job_type_bundle_template_migration.sql`):
- ตาราง `job_type_bundle_templates`/`items`/`item_variants` (รองรับ sub-variant เช่น น้ำมันเกียร์
  CVT vs WS) + คอลัมน์ผูก `job_cost_items.bundle_item_id`/`bundle_variant_id` + trigger
  `fn_update_bundle_item_price_memory` (จำราคาอะไหล่อัตโนมัติ, ค่าแรงไม่จำเด็ดขาดตามที่การ์ดกำหนด)
- RLS: อ่านได้ทุก role ที่ใช้เซตได้ (รวม technician), จัดการได้แค่ Owner/Manager/Admin
- UI ใน `app/jobs/[id]/page.js`: combobox ค้นหา reuse pattern เดิมของ `search_cost_item_history`
  (type-to-filter, click-to-select, ไม่มีทาง "ใช้คำที่พิมพ์" ตรงๆ — ตรงกับที่การ์ดกำหนดไว้สำหรับ
  Technician พอดี) Owner/Manager/Admin เห็นปุ่ม "สร้างชุดใหม่" เพิ่มเมื่อพิมพ์แล้วไม่เจอ เปิด
  `components/JobTypeBundleConfirmModal.js` (หน้าต่างยืนยัน+แก้ไขก่อน save ตามที่การ์ดระบุ) แล้วใส่
  เข้างานปัจจุบันทันที
- หน้าจัดการเพิ่มเติม `app/admin/job-type-bundles/page.js` (ดู/แก้ราคา/ลบเซตเก่า) — นอกเหนือจากที่
  การ์ดขอไว้ (แค่ inline จากหน้างาน) แต่ยืนยันกับคุณอั้มแล้วว่าต้องการ

**✅ Platform Revenue Module** (`db/platform_revenue_migration.sql`) — ขอบเขต **subscription
revenue เท่านั้น**, commission ยังไม่ทำ (บล็อกด้วย marketplace feature ที่ยังไม่ออกแบบ — ไม่เดา
schema/timing ล่วงหน้า):
- ตาราง `platform_journal_entries`/`_lines`/`platform_revenue_events`/
  `platform_deferred_revenue_schedule` — แยกจากบัญชีของอู่ 100% (ตาม convention เดียวกับ
  `platform_admins`/`platform_audit_log`: enable RLS แต่ไม่สร้าง policy เลย เข้าถึงได้เฉพาะผ่าน
  service_role)
- RPC `create_platform_journal_entry` (ตรวจ debit=credit ก่อนบันทึกเสมอ, defense-in-depth
  `auth.uid()` check + role lookup จริงจาก `platform_admins` — pattern เดียวกับ
  `platform_add_admin` ในการ์ด P0 security ก่อนหน้า) และ `recognize_due_platform_revenue`
  (idempotent เต็มรูป, insert entry balance โดยธรรมชาติ 2 บรรทัดเท่ากันเสมอ ไม่ต้องเช็ค sum แยก)
- **pg_cron ใช้งานจริงแล้ว** — schedule รายวัน 01:00 เรียก `recognize_due_platform_revenue()`
  อัตโนมัติ (extension ติดตั้งอยู่แล้วบน project นี้ ไม่ต้อง enable เพิ่ม) แก้ปัญหา "ยังไม่ตัดสินใจกลไก
  cron" เฉพาะฟีเจอร์นี้เท่านั้น — Field Scanner Role/Stock Value Cap Engine ยังมีช่องโหว่เดิมค้างอยู่
  (นอกขอบเขตรอบนี้ แต่ตอนนี้มี precedent ที่ใช้งานจริงแล้วให้ไปหยิบใช้ได้)
- ต้องขยาย `platform_audit_log.action` CHECK constraint เพิ่ม `revenue_journal_entry_created` —
  ถ้าลืมจะพังแบบเดียวกับบั๊กที่เจอในการ์ด P0 security ก่อนหน้า (insert ไม่ผ่าน constraint →
  rollback ทั้ง transaction) — เพิ่มไว้ในไฟล์เดียวกันแล้ว
- Access control **ตัดสินใจกับคุณอั้มแล้ว 23 ก.ค.**: Analyst เห็น journal เต็มเท่า Super Admin
  (ต่างจาก default ที่การ์ดเสนอไว้ว่า Analyst เห็นแค่สรุป) — `DASHBOARD_ROLES`/
  `JOURNAL_DETAIL_ROLES`/`RECORD_REVENUE_ROLES` ใน `app/api/platform/revenue/*/route.js`
- UI: แท็บ "💰 Revenue" ใหม่ใน `/platform-admin` — MRR/ARR, deferred remaining, journal table,
  ปุ่ม "บันทึกรับชำระ" + "Recognize now" — ตาม convention เดิมของหน้านี้ (ไม่ซ่อนปุ่มตาม role เลย
  ปล่อยให้ API ตอบ 403 แทน)
- **Verify แล้วด้วย round-trip test เต็มรูปบน staging** (ไม่ใช่แค่ apply migration เฉยๆ): บันทึก
  รับชำระจริง → schedule 1 งวดย้อนหลัง → `recognize_due_platform_revenue()` รับรู้ถูกแค่งวดที่ถึง
  กำหนด (ไม่แตะงวดอนาคต) → เรียกซ้ำได้ 0 (idempotent ยืนยันแล้ว) → `sum(debit) = sum(credit)`
  ทุกบรรทัด → audit log 2 แถวถูกต้อง (manual actor + system/cron sentinel) → ลบข้อมูลทดสอบทิ้งหมด
  หลังยืนยันผ่าน

**Permission gate ที่เจอระหว่างทำ:** auto-mode classifier บล็อก `execute_sql` (Supabase MCP) เป็น
database-mutating action แยกจากการอนุมัติแผนงาน — คุณอั้มอนุมัติเพิ่ม permission rule ใน
`.claude/settings.local.json` ระหว่างเซสชันแล้ว

**สถานะ:** ทุก migration apply บน staging Supabase จริงแล้ว + verify ผ่าน `get_advisors` (ไม่มี
WARN/ERROR ใหม่นอกเหนือจาก INFO ที่ตั้งใจ — RLS enabled no policy ตาม platform_admins
convention) โค้ดทั้งหมดอยู่ใน local git ของ branch `feature/admin-role-7th-role` (แตกจาก
`staging`) ยังไม่ได้ commit/push — รอคุณอั้มตัดสินใจขั้นตอนถัดไป

---

### 21. คืนวันที่ 24 ก.ค. 2026 — ย้าย dev environment ไป Rocky Linux + แก้บั๊ก + ปิด blocker ของ Accounting Module

**บริบท:** ย้ายงานพัฒนาทั้งหมดจาก Mac ไปเป็น Rocky Linux VM (`192.168.64.3`, ผ่าน UTM) — Mac เก็บไว้แค่เป็น terminal ควบคุม ไม่มีโค้ดโปรเจกต์อยู่ในเครื่องแล้ว (`~/git` เคลียร์ว่างสนิท เก็บไว้เป็น temp folder เปล่า)

**Setup Rocky Linux:**
- ติดตั้ง Claude Code CLI, clone repo (`~/MyGIT/ppongprom-project`, branch `staging`)
- Production deploy จริงบน Rocky ด้วย systemd (`parts-inventory.service`) + nginx reverse proxy (8081→2999) — แยกจาก Vercel staging deployment
- Docker + Playwright (`mcr.microsoft.com/playwright:v1.61.1-noble`) + Selenium Grid (`seleniarm/standalone-chromium` — เครื่องเป็น ARM64 ใช้ image ทางการไม่ได้) รองรับ 6 worker พร้อมกันจริง (verify แล้ว)

**npm audit fix:** bump Next.js → 15.5.21 + override sharp → 0.35.3 แก้ 2 high severity CVE ครบ (0 vulnerabilities)

**Config change:** `idleTimeoutMinutes` 15→360, `idleWarningCountdownSeconds` 100→603 — deploy ครบทั้ง Rocky production, Vercel staging, Vercel main (cherry-pick)

**Notion board audit:** เช็ค status การ์ดเทียบกับโค้ดจริงทั้งบอร์ด พบ misalign 11 การ์ด (ส่วนใหญ่ Not started/In progress ทั้งที่จริงทำเสร็จแล้ว, 1 การ์ดกลับทาง — Job Archiving ที่จริงยังไม่มีโค้ดเลย) แก้ status ให้ตรงหมดแล้ว

**Compliance/Security gap breakdown:** แตกการ์ด "Compliance Gap Assessment" เป็น 7 การ์ดย่อยที่ทำเป็น task จริงได้ (JWT invalidation gap, secret scanning, PDPA legal review, pentest procurement, OWASP ASVS assessment, WCAG audit, ISO 27001 ISMS)

**แก้บั๊ก/เพิ่มฟีเจอร์ (background task, ทำขนานกันหลายตัว):**
- ✅ บั๊ก `shop_id=0` falsy-check ทำให้ `/api/team/create-staff` คืน 400 แทน 403 — แก้แล้ว **พบและแก้เพิ่มอีก 3 endpoint ที่เป็นบั๊กเดียวกัน** (`create-member`, `invite`, `list-with-emails`)
- ✅ Secret scanning ใน CI (`gitleaks` + custom rule จับ `sb_secret_...`) — ยืนยันด้วยการทดสอบจริง (ปลอม fake secret เข้า branch ทดสอบ แล้วดูว่า CI บล็อกจริง) พบว่า service_role key เคยหลุดเข้า git จริง **4 จุด** (มากกว่าที่เข้าใจไว้เดิมว่า 2 จุด)
- 🔄 Concurrent session — แก้ไม่ให้แค่ลบแถวใน `user_sessions` ตอน evict ต้อง invalidate การเข้าถึงจริงด้วย (กำลังทำ)
- 🔄 Feature ใหม่: เบิกอะไหล่จาก generic stock ไปใช้กับงาน (`job_parts_used`) (กำลังทำ)
- 🔄 ขายอะไหล่ที่ยังไม่ตีราคา + Approval Flow แบบ configurable — **ปิด blocker หลักของ Accounting Module** คุณอั้มตัดสินใจคำถามที่ค้างครบ 4 ข้อ (ดู SOP.md หัวข้อ 3) กำลัง implement อยู่

**กติกาใหม่ตั้งแต่คืนนี้:** ทุกครั้งที่ตอบคำถามหรือปรับ/เพิ่ม feature ต้องอัปเดต README.md + SOP.md คู่กันทันที ไม่ปล่อยค้าง

### 22. คืนวันที่ 24 ก.ค. 2026 — Job Type Bundle Template: เสนออะไหล่ซ้ำจาก sub-variant อื่นในเซตเดียวกัน

**บริบท (Notion 3a6f39f4564981ed9addfd3ed14577b3):** เจ้าของร้านถามว่าทำยังไงให้ sub-variant ของ Job Type Bundle Template (เช่น "น้ำมันเกียร์" CVT vs WS) ขึ้นมา "อัตโนมัติ" แทนที่ต้องกด "+ เพิ่ม sub-variant" แล้วค้นหาจากสต็อกทีละตัวเองทุกครั้ง

**ทางเลือกที่พิจารณาแล้วไม่เลือก:** fuzzy-match ชื่อ part (เสี่ยงจับคู่ผิด, ต้องมี threshold/preview ก่อนยืนยัน) และเพิ่ม field/tag ใหม่ให้กรอกตอนเพิ่มอะไหล่เข้าสต็อก (เพิ่ม friction ตอนกรอกสต็อกเพื่อแลกความสะดวกตอนสร้างเซต ซึ่งสร้างไม่บ่อยพอจะคุ้ม)

**ทางที่เลือก (ตัดสินใจแล้ว 24 ก.ค. 2026):** reuse-from-context — กด "+ เพิ่ม sub-variant" แล้วเสนออะไหล่ที่ผูกกับสต็อกไว้แล้วในรายการอื่นของ**เซตเดียวกัน**ที่กำลังสร้าง/แก้อยู่ เป็นปุ่ม "ใช้อันเดียวกับที่เคยผูกไว้แล้ว" กดแล้วได้ผลเหมือนค้นหาจากสต็อกด้วยมือทุกประการ (`selectPartForVariant` เดิม ไม่มี path เลือกอะไหล่คู่ขนาน) ข้อมูลทั้งหมดอยู่ใน form state (`items`) อยู่แล้วเพราะทั้งเซตแก้ในหน้าเดียว ไม่ต้อง query เพิ่มเลย ถ้ายังไม่มีอะไหล่ผูกไว้ที่ไหนในเซตนี้ (เช่น รายการแรกสุด) จะไม่เห็น suggestion — ช่องค้นหาด้วยมือ "🔍 ค้นหาจากสต็อก" ยังเป็น fallback เสมอ

**โค้ด:** `components/JobTypeBundleConfirmModal.js` (`getReuseSuggestions()` + ปุ่ม suggestion ในบล็อก sub-variant) — เฉพาะ modal สร้าง/ผูกเซตใหม่เท่านั้น (ใช้ร่วมกันทั้งจากหน้างานและปุ่ม "+ สร้างเซตใหม่" ใน `/admin/job-type-bundles`) หน้าแก้ไขเซตเดิมแบบ inline expand ใน `/admin/job-type-bundles` ยังไม่มีช่องค้นหาจากสต็อกอยู่แล้วตั้งแต่ต้น จึงไม่มี selection handler ให้ reuse ในจุดนั้น (นอกสโคปงานนี้ — ต้องเพิ่มการค้นหาจากสต็อกที่นั่นก่อนถึงจะทำ suggestion ได้)

**Test:** เพิ่ม BUNDLE-08 (รายการแรกไม่เห็น suggestion) และ BUNDLE-09 (รายการที่สองเห็น suggestion จากอะไหล่ที่ผูกไว้กับรายการแรก, เลือกแล้วได้ part_id/description/ราคาตรงกับค้นหาด้วยมือทุกประการ) ใน `qa-automation/tests/job-type-bundle-search-and-apply.spec.js`

---

---

### 23. คืนวันที่ 24 ก.ค. 2026 — รายงานสรุปสต็อก (Stock Summary Report) — Pro+

**การ์ด:** Notion `3a1f39f4564981d1a15ed167dcd8031b` — ต่อยอด Stock Value Cap Engine + Salvage
Vehicle cost allocation ตามที่การ์ดออกแบบไว้ (v2 — ครอบคลุม salvage vehicle)

**สิ่งที่สร้าง:**
- `db/stock_summary_report_migration.sql` — SQL functions (`fn_shop_stock_parts_detail`,
  `fn_shop_parts_stock_value`, `fn_shop_vehicle_remaining_detail`, `fn_shop_stock_summary_totals`,
  `fn_shop_salvage_vehicle_summary`) — **ข้อ 1 ของรายงาน reuse สูตรของ Stock Value Cap Engine
  ตรงๆ** (คัดลอก expression `coalesce(allocated_cost, price, 0) * quantity` มาแทนที่จะคิดสูตรใหม่
  เอง — invariant ข้ามฟีเจอร์นี้คือจุดที่การ์ดเตือนไว้เองว่าห้ามขัดกัน มี test ยืนยันแล้ว)
- `app/api/reports/stock-summary/route.js` — tier gate (Pro ขึ้นไป) + role gate (owner/manager)
  ตาม pattern เดียวกับ `app/api/sales/export-csv/route.js`
- `app/admin/stock-summary-report/page.js` — หน้ารายงาน 5 ส่วน ลิงก์จาก `/admin`
- `config/reportingThresholds.js` — ค่าคงที่ 2 ตัวที่ **ยังเป็นเลขชั่วคราว** (ดูหัวข้อถัดไป)
- `qa-automation/tests/stock-summary-report.spec.js` — 11 test รวม cross-feature invariant test
  (section 1 ต้องเท่ากับ `shops.current_stock_value` เป๊ะ), เคส "ถอด 10 ขาย 4" ต่อคันซาก, tier gate
  ทั้ง UI+API, multi-tenant isolation, ร้านไม่มีซากรถเลย

**เลขชั่วคราว 2 ตัวที่ยังไม่เคาะจริง (คุณอั้มยังไม่ตอบ ต้องกลับมาคุยทีหลัง):**
- เกณฑ์ "ค้างสต็อกนาน" (ข้อ 4) = **90 วัน** — ค่า default ชั่วคราว ซ้ำประเด็นเดียวกับ NRV check ใน
  การ์ด Salvage cost allocation ที่ก็ยังไม่เคาะเลขนี้เหมือนกัน ควรใช้เลขเดียวกันทั้งคู่
- หน้าต่าง Top 10 (ข้อ 5) = **30 วัน** — ค่า default ชั่วคราว, API รับ `?days=` override ได้แล้ว
  (เผื่อทำ "เลือกได้" ทีหลังไม่ต้องแก้ backend เพิ่ม)

**ขอบเขตที่ตั้งใจไม่ทำรอบนี้:** month-end/point-in-time snapshot (real-time only เหมือน Stock
Value Cap Engine เอง — เป็น known gap ที่การ์ดเองก็ยังไม่ตัดสินใจ), breakdown มูลค่าซากรถค้างถอด
แยกตามยี่ห้อ (schema `salvage_vehicles` ไม่มีคอลัมน์ยี่ห้อตรงๆ ต้อง join 3 ชั้น — breakdown ตามโซน
เท่านั้นในรอบนี้)
---

### 24. คืนวันที่ 24 ก.ค. 2026 — Salvage vehicle cost allocation: 3 ใน 5 edge cases (ตาม Notion page `3a1f39f456498194a822f5d39f7bf608`)

**ขอบเขต:** edge case 1 (write-off, verify เท่านั้น), 2 (ของแถมไม่ประเมิน), 3 (labor cost ผ่าน work
order) — edge case 4 (NRV/ปิดงวด) deferred ตั้งใจ (บล็อกด้วย Accounting Module ที่ยังไม่เริ่ม), edge
case 5 (ขายเกินประมาณการ) ไม่ต้องมีโค้ดใหม่ เขียนแค่ regression test

**Edge case 1 (write-off):** ตรวจแล้วว่า commit `0a1206f` ("Write-off: generic damage/loss action on
any part") อยู่บน `staging`/`origin/staging` จริง (ไม่ใช่ค้างอยู่ branch อื่น) และ implement เป็น
generic action บนตัว part ทุกชิ้นแล้วจริงตามมติการ์ด — ไม่ต้องทำอะไรเพิ่ม

**Edge case 2 (ของแถมที่ไม่ได้ประเมินไว้):** หน้า `/add` (ตอนถอดจากซากรถ) รองรับเว้นว่างช่อง
"มูลค่าประเมิน" อยู่แล้ว (ส่ง `estimated_value: null`) แต่ trigger เดิมปล่อย `allocated_cost` เป็น
`null` ค้าง ไม่ใช่ `0` ตามมติการ์ด — แก้ `fn_allocate_salvage_part_cost` ให้ชิ้นที่ผูก
`salvage_vehicle_id` แต่ `estimated_value = null` ได้ `allocated_cost = 0` เสมอ (แยกจาก parts ปกติที่
ไม่เกี่ยวกับ salvage เลยซึ่งยัง `null` เหมือนเดิม) ไม่กระทบอะไหล่ชิ้นอื่นในคันเดียวกันเลย

**Edge case 3 (labor cost ผ่านใบงานถอด/ทำความสะอาด) — ฟีเจอร์ใหม่หลักรอบนี้:**
- ตาราง `salvage_vehicle_work_orders` ใหม่: `scope`, `estimated_duration_hours`,
  `actual_start`/`actual_end`, `assigned_to` (uuid ช่าง), `labor_rate`, `labor_cost`, `status`
  (`open`/`closed`) — สร้าง/ปิดผ่าน RPC เท่านั้น (`create_salvage_work_order`/
  `close_salvage_work_order` — เช็คสิทธิ์ Owner/Manager/Supervisor จาก `auth.uid()` เอง, pattern
  เดียวกับ `sell_salvage_vehicle_scrap`) — RLS block insert/update ตรงจาก client ทั้งหมด (defense
  in depth)
- `labor_cost` = `estimated_duration_hours × labor_rate` (**ชั่วคราว**) ตอนสร้างใบงาน → เปลี่ยนเป็น
  เวลาจริง (`actual_end - actual_start`) `× labor_rate` (**จริง**) อัตโนมัติตอนปิดใบงาน
- `salvage_vehicles.labor_cost` (คอลัมน์ใหม่) = ผลรวม `labor_cost` ของทุกใบงานของคันนั้น sync
  อัตโนมัติผ่าน trigger `trg_sync_salvage_vehicle_labor_cost` ทุกครั้งที่ใบงานเปลี่ยน — **ไม่ถูก
  freeze** โดย `fn_freeze_salvage_valuation` เดิม (ฟังก์ชันนั้นเช็คแค่
  `estimated_total_value`/`value_groups`) จึงอัปเดตได้แม้คันเข้าสถานะ `disassembling` ไปแล้ว
- **จุดคำนวณที่แก้ (จุดเดียวกับที่มีอยู่แล้ว ไม่สร้าง path คู่ขนาน):** `fn_allocate_salvage_part_cost`
  — ฐานคำนวณเปลี่ยนจาก `purchase_price` อย่างเดียว เป็น `(purchase_price + labor_cost)` ก่อนปัน
  สัดส่วน relative sales value (ตรง TAS2/IAS2 ย่อหน้า 14 มากกว่า) — `sell_salvage_vehicle_scrap`
  (คำนวณเศษเหล็กที่เหลือ) แก้ฐานเดียวกันด้วย
- **ไม่มีการ recalculate ย้อนหลัง:** อะไหล่ที่คำนวณ `allocated_cost` ไปแล้วก่อนหน้าไม่เปลี่ยนแม้
  `labor_cost` จะเปลี่ยนจากชั่วคราวเป็นจริงทีหลัง (trigger คำนวณแค่ตอน insert/update แถว part แถวนั้น
  เท่านั้น ไม่เคยวน recompute แถวอื่นอยู่แล้วโดยธรรมชาติของ design เดิม — สอดคล้องกับกฎ "freeze ตั้งแต่
  เริ่มถอดชิ้นแรก" ไม่ใช่ backdoor รอบมัน)
- UI: หน้ารายละเอียดรถ (`/salvage-vehicles/[id]`) เพิ่มหัวข้อ "🧰 ใบงานถอด/ทำความสะอาด" — ฟอร์มสร้าง
  ใบงาน (scope, ระยะเวลาประมาณการ, เลือกช่าง, อัตราค่าแรง) + ปุ่ม "✅ ปิดใบงาน" ต่อใบ + แสดง
  `labor_cost` รวมของคัน และฐานคำนวณ (`purchase_price + labor_cost`) ที่การ์ดสรุปมูลค่ารถ
- Migration: `db/salvage_vehicle_labor_cost_and_work_order_migration.sql`

**Edge case 4 (NRV ตอนปิดงวด):** ยังไม่ทำโดยตั้งใจ — comment ไว้ในไฟล์ migration ข้างต้นว่า blocked
on Accounting Module (`accounting_periods` ยังไม่มี) ไม่ใช่ลืม

**Edge case 5 (ขายเกินประมาณการ):** ไม่มีโค้ดใหม่ (allocation คำนวณจากสัดส่วนประมาณการเท่านั้น
โดยโครงสร้างอยู่แล้ว) — ล็อกด้วย regression test กันแก้ "ให้ฉลาดขึ้น" ทีหลังโดยไม่ตั้งใจ

**Test:** `qa-automation/tests/card-salvage-vehicle-cost-allocation-edge-cases.spec.js` (ไฟล์ใหม่ —
แยกจาก `card-salvage-vehicle-intake.spec.js` เดิมที่ขอบเขตจำกัดแค่ "Intake" ตามที่ระบุไว้ในไฟล์นั้นเอง)
ครอบคลุมทั้ง 4 edge case ที่ actionable (1, 2, 3, 5) รวม numeric example ตัวอย่างจากการ์ด:
purchase_price 100,000 + labor_cost 5,000 = 105,000 → ปันสัดส่วน 60/40 = 63,000/42,000 (รวม =
105,000 เป๊ะ) — verify ผ่านจริงบน staging

### 25. คืนวันที่ 24 ก.ค. 2026 — Field Visibility Whitelist กลาง: de-duplication ครบ 4 การ์ด + settings UI

Notion card `3a1f39f4564981f1b544ca7ab0b00973` — เซสชันก่อนหน้า (21 ก.ค.) สร้าง
`config/fieldVisibility.js` + `shop_field_visibility_overrides` + floor rules ไว้แล้ว แต่ wire เข้า
Export CSV แค่ 1 ใน 4 การ์ดที่ควรใช้ matrix นี้ (Custom Report Builder/API พื้นฐาน ยังไม่มีโค้ด —
deferred ตามการ์ดของตัวเอง, N/A ต่อไป) เซสชันนี้ปิดของที่เหลือ:

- **บั๊กที่เจอ:** `db/field_visibility_overrides_migration.sql` เขียนก่อนการ์ด "Admin Role (7th
  role)" landing (23 ก.ค.) — CHECK constraint ของคอลัมน์ `role` กับ floor-enforcement trigger ไม่มี
  `'admin'` เลย ทั้งที่ `config/fieldVisibility.js` มี `DEFAULT_FIELD_VISIBILITY.admin` +
  `FLOOR_RULES` ที่อ้างถึง admin อยู่แล้ว — แก้ด้วย `db/field_visibility_admin_role_fix_migration.sql`
  (idempotent, verify ผ่าน Supabase MCP บน staging DB จริงแล้ว)
- **Field Scanner ดูข้อมูลลูกค้าไม่ได้ (floor rule) — เจอว่ายังไม่เคย implement เลย:** `/jobs` และ
  `/jobs/[id]` เดิม query ตรงจาก client (RLS scope แค่ `shop_id` ไม่เคยกรองคอลัมน์ตาม role) — เพิ่ม
  `app/api/jobs/route.js` + `app/api/jobs/[id]/route.js` ใหม่ mask `customer_name`/`customer_phone`
  ฝั่ง server ก่อนส่งกลับเสมอ ตามกติกาข้อ 1 ของการ์ด (server เป็น source of truth) — หน้า client ทั้ง
  2 อ่านผ่าน route ใหม่แทนการ query ตรง
- **หน้ารายงาน (`/admin/reports`, `/admin/stock-summary-report`) เดิม hardcode role gate เอง** ไม่
  ตรงกับ default matrix กลาง (supervisor/admin ควรเห็น `sales_reports` ได้ default) และ Owner ไม่มี
  ทาง override — เพิ่ม `app/api/reports/sales/route.js` ใหม่ + retrofit
  `app/api/reports/stock-summary/route.js` ให้เช็ค `canSeeField(role, "sales_reports")` จาก matrix
  กลางแทน, mask ชื่อลูกค้า/`allocated_cost` ตาม field group ของมันเองด้วย
- **`app/admin/settings/field-visibility/page.js` ใหม่** — Owner ปรับ override matrix ต่อร้านได้
  mirror pattern เดียวกับ `app/admin/settings/admin-approvals/page.js` เป๊ะ (supabase upsert ตรง,
  RLS + DB trigger เป็นตัวบังคับจริง) ช่องที่เป็น floor แสดง disabled ใน UI ด้วย (ไม่ใช่แค่ปฏิเสธเงียบๆ
  ฝั่ง server)
- **Test:** `qa-automation/tests/field-visibility-whitelist.spec.js` (ไฟล์ใหม่ 13 tests) — เช็คว่า
  field ต้องห้ามหายไปจาก response body จริง (ไม่ใช่แค่ DOM) ข้าม export-csv/jobs API/reports API, และ
  owner พยายาม override เหนือ floor ผ่าน DB ตรงๆ (ข้าม UI ทั้งหมด) ต้องโดนปฏิเสธเสมอ — ผ่านทั้งหมด
  บน staging

**Known gap ที่ตั้งใจไม่แก้รอบนี้ (documented ไม่ใช่ลืม):** user ที่มี role หนึ่งๆ ยัง query
supabase-js ตรงๆ ข้าม Next.js API layer ได้ (bypass การ mask ที่ route ทำไว้) เพราะ RLS ของโปรเจกต์นี้
scope แค่ `shop_id` ไม่เคย scope column ต่อ role แอปเลย — เป็น limitation เดิมที่กระทบ
`config/rolePermissions.js` (`view_price`) อยู่แล้วซึ่งซ่อนแค่ฝั่ง client ใน `app/page.js` เท่านั้น
แก้ทั้งโปรเจกต์นอกขอบเขตการ์ดนี้ — ต้องทำผ่าน Postgres view/RPC ที่เช็ค role จาก `auth.uid()` เอง
ถ้าจะแก้จริง

### 26. คืนวันที่ 24 ก.ค. 2026 — Accounting Module (scoped-down first pass): ผังบัญชี + journal entries + ปิดงวด

Notion card `3a1f39f4564981bcba6ce1b5e8c66761` ("Accounting Module — ผังบัญชี + journal entries +
intercompany", XL — การ์ด core feature ที่ใหญ่ที่สุดในระบบ) ทั้ง 2 blocker (`zones.owner_type` +
`owner_entity_id`, กลไก ToS consent) ปิดไปแล้วก่อนหน้า — รอบนี้คือ scoped-down first pass ของการ์ด
XL นี้ ไม่ใช่ทั้งหมด (ดู SOP.md ข้อ 6 สำหรับสถานะละเอียด ✅/🔜)

**สร้าง:**
- `db/accounting_module_migration.sql`:
  - `accounting_accounts` — ผังบัญชี 7 หลัก ([หมวด 1][segment 2][รายละเอียด 4]) seed มาตรฐาน 9
    บัญชีอัตโนมัติต่อร้านตอนเปิดโมดูล (`fn_seed_default_chart_of_accounts`)
  - `journal_entries`/`journal_entry_lines` — ไม่มี insert/update policy ตรงบนตาราง เขียนได้ทาง
    เดียวผ่าน RPC/trigger security definer เท่านั้น invariant Σ debit = Σ credit บังคับใน
    `create_journal_entry()` (mirror ของ `create_platform_journal_entry()` ใน
    `db/platform_revenue_migration.sql` — คนละชุดบัญชีกันคนละ table เพราะเป็นสมุดบัญชีคนละระดับ
    platform vs. shop) — audit trail ผูกกับ `fn_audit_row_change()` กลาง (ต้องขยายให้รู้จัก
    `entry_id` เพิ่มเพราะ generic trigger ไม่ auto-apply กับตารางใหม่)
  - `accounting_periods` — ปิดงวดรายเดือน (`close_accounting_period()`), เปิด/หา period อัตโนมัติ
    (`fn_get_or_open_period()`), และ `fn_is_period_closed(shop_id, date)` เป็น clean read-only
    hook ให้ฟีเจอร์อื่นในอนาคต (เช่น NRV check ของ Salvage cost allocation) ต่อได้โดยไม่ต้องรู้
    internal
  - `consignors` — ตารางใหม่ (ไม่เคยมีมาก่อน, verify แล้ว) ที่ `zones.owner_entity_id` อ้างถึงเมื่อ
    `owner_type='consignment'` เก็บ `default_commission_rate` + validate ผ่าน trigger (ไม่ใช่ hard
    FK เพราะ `owner_entity_id` ต้องใช้ร่วมกับ investor ในอนาคตที่อาจอ้างคนละตาราง) —
    `parts.commission_rate_override` ให้ override รายชิ้นได้
  - Trigger `trg_post_sale_journal_entry` บน `part_sales` (fire ตอน insert หรือ
    `item_status`/`approval_status` เปลี่ยนเป็น `completed`/ไม่ใช่ `pending_approval` — ตรงกับ
    "pack date" ที่ตัดสินใจไว้แล้วเรื่องจังหวะ VAT พอดี) แยก 2 event rule:
    - **own:** Dr เงินสด/ธนาคาร (cash/bank_transfer/card/other) หรือ Dr ลูกหนี้การค้า
      (payment_method='credit') / Cr รายได้ + Cr VAT output (7%) + ตัด COGS
      (`coalesce(allocated_cost, price, 0)`)
    - **consignment:** Agent model ตาม TFRS15/IFRS15 — Dr เงินสด/ธนาคารเต็มยอด / Cr เจ้าหนี้
      ผู้ฝากขาย (ยอด−ค่าคอมมิชชั่น) + Cr รายได้ค่าคอมมิชชั่น — ไม่มี COGS เลย
  - `set_accounting_module_enabled()` — enable/disable ต่อร้าน (`shops.accounting_module_enabled`)
    + seed ผังบัญชี + backfill รายการขายของ**งวดปัจจุบันที่ยังเปิดอยู่เท่านั้น**ตอนเปิดครั้งแรก
    (งวดก่อนหน้าที่ปิดแล้วไม่แตะ) + tier gate (pro/enterprise เท่านั้น) ในตัว RPC เอง ไม่ใช่แค่ UI
  - `record_ar_payment_received()`/`record_consignor_payout()` — RPC สำหรับเหตุการณ์ "รับชำระจริง"
    ตามมติการ์ด payment_method (ยังไม่มี UI ผูกรอบนี้ — known gap)
  - `part_sales.payment_method` เพิ่ม `'credit'` (ขายเชื่อ) ตามที่การ์ด payment_method เดิมทิ้งไว้
- `config/accountingConfig.js` — `VAT_RATE` (0.07, ซ้ำกับ `fn_vat_rate()` ฝั่ง DB ตั้งใจ pattern
  เดียวกับ `stockValueCap`), `hasAccountingModuleFeature()`
- `config/subscriptionTiers.js` — เพิ่ม feature `accounting_module` ให้ tier `pro` (enterprise ได้
  อยู่แล้วผ่าน `"all"`)
- `app/admin/accounting/page.js` ใหม่ — ผังบัญชี/งวดบัญชี (ปุ่มปิดงวด)/journal entries (ตารางง่ายๆ
  ตามที่การ์ดขอ ไม่เน้น UI polish)
- `app/admin/page.js` — การ์ด toggle เปิด/ปิดโมดูล (เรียก `set_accounting_module_enabled()` ไม่ใช่
  UPDATE ตรงๆ เพราะมี side effect seed/backfill) + ซ่อนถ้า tier ไม่ผ่าน
- `app/checkout/page.js`, `app/edit/[id]/page.js`, `app/admin/reports/page.js` — เพิ่มตัวเลือก/label
  `payment_method='credit'`

**Out of scope โดยตั้งใจ (ไม่ใช่ลืม):**
- Intercompany/shop_groups/consolidation — blocked บน Multi-branch support (Notion ยัง
  "Not started" จริง, verify แล้ว) — ระบบมี `branches` table แล้ว (child table ของ shop เดียว ตาม
  Option A ที่การ์ด Multi-branch เลือก) แต่ยังไม่มี `shop_groups`/แนวคิดอู่ในเครือข้ามคนละ shop_id
  เลย ไม่เดา schema เอง
- Investor model (กิจการร่วมค้าแบ่งกำไร) — การ์ดต้นทางเองบอกว่ายังไม่ได้ออกแบบ journal แยกต่างหาก
- NRV check ผูกปิดงวด — Edge Case 4 ของการ์ด Salvage cost allocation (คนละการ์ด) —
  `fn_is_period_closed()` เปิดช่องให้ต่อได้แล้ว

**Test:** `qa-automation/tests/accounting-module-core.spec.js` (12 tests, ผ่านทั้งหมดบน staging) —
debit=credit invariant, own sale (cash/credit), consignment sale (no COGS), module off, backfill,
period close reject, tier gate (RPC + UI), informal vs formal ไม่ drift. Regression: 
`card-payment-method.spec.js` (3), `stock-summary-report.spec.js` (11), `unpriced-part-sale-approval.spec.js`
(7) — ผ่านทั้งหมด ไม่มี regression จากการเพิ่ม trigger ใหม่บน `part_sales`.

### 27. คืนวันที่ 24 ก.ค. 2026 — อัปเดต `USER_MANUAL.md` ให้ตรงกับสถานะแอปปัจจุบัน

Notion card "User Manual — Parts Inventory (draft)" — เอกสารเดิมหยุดอัปเดตไว้ที่ 20-21 ก.ค. 2026
(5 บทบาท, idle timeout เขียนผิดเป็น 15 นาที) ตรวจกับ `SOP.md` (13 หัวข้อ) ทีละหัวข้อ + อ่านโค้ด
UI จริง (ไม่ใช่แค่ paraphrase SOP.md) แล้วเขียนใหม่ทั้งไฟล์ โครงสร้างจัดตามบทบาทก่อน (7 บทบาทตอนนี้
รวม Admin ที่ 7 และ Field Scanner ที่ 6) แล้วค่อยแยกฟีเจอร์ในมุมมองของบทบาทนั้น — เพิ่มเนื้อหาที่
ขาดของฟีเจอร์ที่ทำเสร็จช่วง 20-24 ก.ค.: ระบบตะกร้าขาย, ขายของไม่ตีราคา + Approval Flow, เบิกอะไหล่
เข้างาน (`job_parts_used`), Job Type Bundle reuse-from-context suggestion, Salvage vehicle ใบงาน
ถอด/ค่าแรง, Admin role + Maker-Checker queue, Field Visibility settings UI, Stock Summary Report,
โมดูลบัญชี (scoped-down first pass) — และ **Multi-branch support** ซึ่งขึ้น staging พร้อม UI จริง
(`/admin/branches`, branch switcher) ระหว่างที่กำลังเขียนเอกสารนี้พอดี (เห็นตอน `git log` รอบสุดท้าย
ก่อนปิดงาน จึงตรวจโค้ดเพิ่มแล้วเขียนสรุปสั้นๆ เข้าไปด้วย) แก้ไขตัวเลข idle timeout ให้ตรงกับ
`config/subscriptionTiers.js` จริง (360 นาที ไม่ใช่ 15) ปรับปรุงหัวข้อ "ยังขาด" ท้ายเอกสารใหม่ตาม
สถานะ ✅/🔜/❌ ล่าสุดของ `SOP.md` (ไม่ใช่คัดลอกลิสต์เดิม)

### 28. คืนวันที่ 24 ก.ค. 2026 — Multi-branch support (Pro=2 สาขา, Enterprise=ไม่จำกัด)

Notion card `3a1f39f45649810cb1fffbfa5da1d799` — feature ใหญ่ที่สุดในลิสต์ ⚠️ ระบบเดิมออกแบบ
multi-tenant แบบ "shop = 1 อู่" เท่านั้น ไม่มีแนวคิด "สาขาในร้านเดียวกัน" เลย งานนี้เพิ่ม `branches`
เป็น child table ของ `shops` (1 shop_id/1 subscription ครอบทุกสาขา — **คนละเรื่องกับ "อู่ในเครือ"/
shop_groups ที่ Accounting Module อ้างถึง ซึ่งคือคนละ shop_id/คนละเจ้าของ/คนละเลขผู้เสียภาษี และยัง
ไม่มีโค้ดใดๆ เลย** ดู `SOP.md` section 15 สำหรับคำอธิบายแยก 2 concept นี้ให้ชัด)

- **Schema:** `db/multi_branch_support_migration.sql` — `branches` table + `branch_id` บน
  `shop_members`/`parts`/`jobs`/`zones`/`visibility_groups`/`shop_invites`. `shop_members` เปลี่ยน
  unique constraint จาก `(shop_id, user_id)` เป็น **`(shop_id, user_id, branch_id)`** — role ตอนนี้
  เป็นต่อ (user, branch) แทนที่จะเป็นต่อ shop เดียว (คนเดียวกันเป็น Manager สาขา 1 + Technician สาขา
  2 พร้อมกันได้) — **Data migration** (สำคัญสุดตามการ์ด): backfill 1 สาขา default ต่อร้านเดิมทุกร้าน
  ผูกทุกแถวเข้าสาขานั้นครบ ไม่มีข้อมูลหาย, idempotent, ตรวจ row count จริงบน staging
  (qmqabtrrubqcmafietsr) ก่อน/หลังตรงกันทุกตาราง
- **RLS:** `is_branch_member(branch_id, roles)` ใหม่ (owner/manager ข้ามทุกสาขาของร้านตัวเองได้
  — judgment call, การ์ดไม่ได้ระบุตรงๆ) + `is_branch_writable(branch_id)` (เช็ค read-only หลัง
  downgrade) แทนที่ `is_shop_member` บน parts/jobs/zones/visibility_groups
  - **บั๊กที่เจอจริงระหว่างทดสอบ (24 ก.ค. 2026):** Postgres RLS permissive policies OR รวมกัน ไม่ใช่
    AND — `parts` มี policy "estimated_value floor on insert/update" แยกที่ไม่เช็ค branch เลย ทำให้
    owner ยัง insert/update อะไหล่ในสาขา read-only ได้ผ่าน policy นั้น (bypass) เจอจาก
    `qa-automation/tests/multi-branch-support.spec.js` TC-MB-5 แก้แล้วโดยเพิ่มเงื่อนไข
    branch-writable เข้าไปในทุก permissive policy ของตารางเดียวกัน
  - **บั๊กที่เจอจริงจาก regression sweep เต็มรูปแบบ:** `jobs.branch_id`/`visibility_groups.branch_id`
    เป็น NOT NULL แต่ `create_job_atomic()`/`create_job_with_visibility_groups()` RPC และ
    `app/admin/groups/page.js` ไม่เคยตั้งค่านี้เลย → **job/visibility-group สร้างไม่ได้เลยสำหรับทุก
    ร้าน แม้สาขาเดียว** (regression ร้ายแรงที่กระทบผู้ใช้จริง 99%+ ถ้าไม่จับได้ก่อน deploy) — แก้ด้วย
    `db/multi_branch_support_writepath_fix_migration.sql`: trigger กลาง `trg_autofill_branch_id()`
    เติม branch_id อัตโนมัติ (สาขาของ user เอง หรือ fallback สาขา default ของร้าน) ก่อน insert บน
    `jobs`/`visibility_groups`/`parts`/`zones` ทุกครั้งที่ caller ไม่ได้ส่งมา — ปิดช่องโหว่แบบเดียวกัน
    ทั้งระบบโดยไม่ต้องไล่แก้ทีละจุดเรียก + แก้ `create_job_atomic`/`create_job_with_visibility_groups`/
    `sell_salvage_vehicle_scrap` ให้ resolve branch_id ตรงๆ ด้วย (ชั้นป้องกัน 2 ชั้น)
  - **บั๊กเล็กที่เจอ:** `verifyShopManager`/query อื่นๆ ที่ใช้ `.maybeSingle()` บน `shop_members`
    throw ทันทีถ้า user มีมากกว่า 1 แถวต่อ shop (คนละสาขา) — แก้เป็น `getCallerShopRole()` (เลือก
    role สูงสุดข้ามทุกแถว) ใน `lib/teamAuth.js` และ 7 call site อื่น (export-csv ×3,
    burst-mode-extension, list-with-emails, create-member, `app/api/jobs`)
- **Tier limit:** Starter/Founder/Trial = 1 สาขา (สร้างเพิ่มไม่ได้เลย — Trial ไม่ได้ระบุตรงๆ ในการ์ด,
  judgment call ให้เท่า Starter/Founder), Pro = 2, Enterprise = ไม่จำกัด — `config/subscriptionTiers.js`
  `maxBranches` + SQL `fn_tier_max_branches`/trigger `trg_branches_tier_limit` (2 ที่ตาม pattern
  เดียวกับ Stock Value Cap Engine) + `app/api/branches` (POST) เช็คซ้ำชั้น API
- **Downgrade Enterprise→Pro ขณะมีสาขาเกิน limit:** ยอม downgrade เสมอ ไม่บล็อก — เจ้าของร้านเลือกเอง
  ผ่าน `/admin/branches` ว่าสาขาไหนเป็น `is_read_only` (ดูข้อมูลได้ แก้ไข/ขาย/สร้างงานใหม่ไม่ได้ —
  สาขา default ตั้ง read-only ไม่ได้เด็ดขาด)
- **Stock Value Cap Engine / concurrent-session limit ไม่เปลี่ยนแปลงเลย** — ยังนับรวมทั้งร้านตามที่
  การ์ดตัดสินใจ (ไม่ใช่แยกต่อสาขา)
- **UI:** branch switcher ใน `components/AppShell.js` (mirror shop switcher เดิม, ซ่อนถ้าสาขาเดียว),
  `app/admin/branches/page.js` ใหม่ (สร้างสาขา + toggle read-only), `lib/AuthProvider.js` เพิ่ม
  `branchMemberships`/`currentBranchId`/`currentBranch`/`switchBranch`
- **Backward compat:** ร้านสาขาเดียว (>99% ของร้านตอนนี้) ไม่เห็นการเปลี่ยนแปลงใดๆ เลยหลังแก้ 2 บั๊ก
  ข้างต้น — ทุก helper fallback ไปสาขาเดียวที่มีอัตโนมัติแบบโปร่งใส
- **Test:** `qa-automation/tests/multi-branch-support.spec.js` (TC-MB-1..6, 10 tests) — data
  migration integrity, tier limits (API), branch-scoped isolation (RLS), per-branch role,
  downgrade read-only, stock-cap whole-shop — ผ่านทั้งหมดบน staging + regression sweep กว้าง
  (rbac/api-rbac/job-creation-\*/job-type-bundle-rbac/job-parts-used/concurrent-session/session/
  card-move-part-zone-action/card-move-parts-unassigned/card-zone-qr-and-print-labels/
  card-part-audit-history) รันซ้ำหลังแก้ 2 บั๊กข้างต้นแล้ว

**Out of scope ตั้งใจ (การ์ดแยกต่างหาก, อ่านแล้วแต่ไม่ได้สร้าง):** "โอนอะไหล่ข้ามสาขา (Branch
Transfer)" (Notion `3a2f39f4564981829c4dc50a2d92decf`) — schema ของงานนี้ (`parts.branch_id`)
ออกแบบให้รองรับการ์ดนั้นได้ตรงๆ โดยไม่ต้องแก้ shape เพิ่ม (เพิ่ม `part_transfers`/
`transfer_line_items` แยกทีหลัง)

**Known residual risk (ยังไม่ปิดสนิท 100%):** cross-branch visibility rule (owner/manager เห็นข้าม
สาขา, role อื่นไม่เห็น) เป็น judgment call ไม่ใช่มติที่การ์ดระบุไว้ตรงๆ ทุกกรณี, และ UI สร้าง
job/สาขาที่เจาะจงเลือกได้ยังไม่ได้ต่อเข้ากับ branch switcher (ตอนนี้ fallback อัตโนมัติเสมอ) — ควรให้
product owner review ก่อนถือว่าปิดงานสนิท

### 29. คืนวันที่ 24 ก.ค. 2026 — `middleware.js`: server-side route protection (defense-in-depth)

ที่มา: OWASP ASVS Level 1 self-assessment (Notion page `3a7f39f4564981db8a6fdd71aec69c61`) +
residual risk ที่ commit `812b8b8` ("verifyCaller now checks user_sessions liveness") ระบุไว้ตรงๆ
ในคอมมิทตัวเอง — การ์ดนั้นปิด gap แค่ฝั่ง Next.js API route (`app/api/**`) เท่านั้น ไม่แตะ
page-routing layer เลย แอปนี้ไม่เคยมี Next.js middleware มาก่อนตั้งแต่เริ่มโปรเจกต์ — การป้องกัน
เส้นทางทั้งหมดอยู่ที่ `components/RequireAuth.js` (client component) ชั้นเดียว แปลว่า request ที่
ไม่มี session เลยยังได้รับ page shell + JS bundle เต็มๆ ก่อน ให้ client-side check ค่อย redirect
ทีหลัง (ช่องโหว่จริงแต่ modest — ไม่มีข้อมูลรั่ว แค่ page shell/bundle เปล่าๆ)

**สร้าง:**
- `middleware.js` (ใหม่, root ของ repo) — official pattern ของ `@supabase/ssr`'s
  `createServerClient`: อ่าน/เขียน auth cookie ผ่าน middleware request/response cookie API, เรียก
  `supabase.auth.getUser()` (ยืนยัน JWT จริงกับ Supabase Auth server + refresh คืน cookie อัตโนมัติ
  ถ้าใกล้หมดอายุ — ไม่ใช้ `getSession()` เพราะแค่อ่าน cookie เฉยๆ ไม่ยืนยันอะไร) แล้ว redirect ไป
  `/login` (307) ถ้าไม่มี session ที่ยังไม่หมดอายุ สำหรับทุกเส้นทางที่ไม่ใช่ public path
  - Public paths (ไม่ต้องมี session เลย): `/login`, `/staff-login`, `/signup`, `/reset-password`,
    และ `/share/customer/[token]/**` (token-based, ไม่ใช่ Supabase Auth session — ดู
    `app/share/customer/[token]/page.js` + `app/api/public/customer/[token]/route.js` — ยืนยันแล้ว
    จากโค้ดจริงว่าไม่ผูกกับ session ก่อนเขียน matcher)
  - `app/legal/**` **ไม่ได้อยู่ใน public list** — ตรวจโค้ดจริงพบว่า 3 หน้านี้ (`tos`/`privacy`/`dpp`)
    ห่อด้วย `RequireAuth` อยู่แล้ว (ต้อง login ถึงจะเข้าได้ในโค้ดปัจจุบัน — ไม่ได้ลิงก์จาก
    `/login`/`/signup`/`/staff-login` เลยสักที่ ส่วน ToS consent ตอน signup ใช้
    `components/TosConsentGate.js` ที่ inline เนื้อหาเองจาก `config/tosContent.js` ไม่ได้ลิงก์ไปหน้า
    `/legal/tos`) จึงจัดเป็น protected ให้ตรงกับพฤติกรรมเดิมทุกประการ ไม่ใช่เดาตามชื่อไฟล์
  - `/api/**` ไม่ถูกแตะเลย (ยกเว้นทั้งหมดจาก matcher) — มีชั้น auth ของตัวเองอยู่แล้ว
    (`verifyCaller()` ผ่าน `Authorization: Bearer` header ไม่ใช่ cookie-based session) ครอบซ้ำจะพัง
    `/api/public/customer/[token]` โดยไม่ได้อะไรเพิ่ม
  - Matcher ยกเว้น `_next/static`, `_next/image`, `favicon.ico`, ไฟล์ static ทั่วไป (รูป/ฟอนต์/
    JS/CSS) เพิ่มเติมจาก `/api/**` — กันยิง `supabase.auth.getUser()` (network round-trip) ทุก
    request ของ static asset โดยไม่จำเป็น
- `lib/supabaseClient.js` — เปลี่ยนจาก `createClient` (`@supabase/supabase-js` เดิม, เก็บ session
  ใน **localStorage**) เป็น `createBrowserClient` (`@supabase/ssr`, เก็บ session ใน **cookie**
  แทน) — จำเป็นคู่กับ middleware เสมอ เพราะ middleware รันฝั่ง edge อ่านได้แค่ cookie เท่านั้น ไม่มี
  สิทธิ์เข้าถึง localStorage ของ browser ถ้าไม่เปลี่ยนตัวนี้ **ทุกคนที่ login อยู่จริงจะถูกเด้งไป
  `/login` ทันทีที่ deploy** (ความเสี่ยงตัวสูงสุดของงานนี้ — ตรวจพบและแก้ก่อน push จริง ไม่ใช่หลัง)
  API หน้าตาเดิมทุกอย่าง (`supabase.auth.*`, `.from()`, `.rpc()`) ไฟล์อื่นที่ import `supabase` จาก
  ที่นี่ (`AuthProvider.js`, `RequireAuth.js`, ทุกหน้า) ไม่ต้องแก้อะไรเพิ่ม
- `package.json`/`package-lock.json` — เพิ่ม `@supabase/ssr@^0.12.3` (peer dep `^2.110.5` ตรงกับ
  `@supabase/supabase-js` ที่ install จริงอยู่แล้ว แม้ `package.json` เดิมเขียน `^2.45.4` ไว้)

**ไม่ครอบคลุม (ตั้งใจ):**
- ASVS top gap #1 ("ไม่มี server-side session revocation สำหรับ direct-to-Supabase traffic") —
  middleware ทำงานแค่ตอน navigate หน้า Next.js เท่านั้น ไม่ได้แทรกอยู่ระหว่าง browser กับ Supabase
  REST ที่ยิงตรงหลังหน้าโหลดเสร็จแล้ว (เช่น เครื่องที่ถูก evict จาก concurrent-session cap — JWT
  เดิมยังผ่านเช็คนี้ได้จนกว่าจะหมดอายุเอง) คนละ gap คนละ layer กัน ยังต้องแก้แยกต่างหาก
- Role/tier/branch authorization ละเอียด — ยังอยู่ที่ `RequireAuth.js` (`allowedRoles`), API routes,
  RLS policies เหมือนเดิมทุกประการ **`RequireAuth.js` ไม่ถูกแก้/อ่อนลงเลย** — เป็นชั้นเสริมก่อนหน้า
  เท่านั้น (additive defense-in-depth)

**Test:** `qa-automation/tests/middleware-route-protection.spec.js` (ใหม่, 17 tests, ผ่านทั้งหมดบน
staging) — protected paths (`/`, `/jobs`, `/admin`, `/add`) ไม่มี session ต้องได้ raw 307 redirect
ตรงจาก server (พิสูจน์ผ่าน `page.request` + `maxRedirects:0` ว่าเป็น middleware ทำจริง ไม่ใช่แค่
client-side fallback), public paths + share-link portal (ทั้ง page และ `/api/public/customer/**`
เอง) ยังเข้าได้ปกติไม่ถูก redirect, owner login แล้ว navigate `/jobs`/`/admin` ปกติไม่ถูกบล็อก.
Regression sweep กว้าง: `rbac.spec.js`, `api-rbac.spec.js`, `job-creation-rbac.spec.js`,
`session.spec.js`, `card-tos-consent.spec.js`, `card-payment-method.spec.js`,
`job-creation-basic.spec.js`, `job-creation-multitenancy.spec.js` — ผ่านหมดทุกไฟล์บน staging จริง
(ทั้งหมดรันหลัง push จริงต่อ `https://parts-inventory-staging.vercel.app`, รอ Vercel READY ก่อน)

**พบ+แก้ระหว่างทาง (regression จากการเปลี่ยน session storage):**
`qa-automation/fixtures/api-helpers.js`'s `getAccessToken()` เดิมอ่าน session จาก
`window.localStorage` ตรงๆ (คีย์ `sb-*-auth-token`) พังทันทีที่ session ย้ายไปอยู่ cookie แทน (คืน
`null`, ทำให้ `api-rbac.spec.js` TC-205a/b/d fail ด้วย token ว่าง) — แก้ให้อ่านจาก
`page.context().cookies()` แทน (ชื่อ cookie `sb-<project-ref>-auth-token`, ค่าเป็น `"base64-" +`
base64 ของ JSON session object, รองรับ chunking `.0`/`.1`/... ของ `@supabase/ssr` ด้วยแม้ session
ปกติของแอปนี้จะยังไม่เกิน threshold นั้น) — ยืนยันรูปแบบ cookie จริงด้วยสคริปต์ log in จริงกับ
staging ก่อนเขียนโค้ด ไม่ได้เดา (commit `6f25464`)

**Known, ไม่เกี่ยวข้องกัน (ยืนยันด้วยการทดสอบจริง):** `job-type-bundle-rbac.spec.js` มี 3 tests fail
ด้วย Postgres error `42P10` (ON CONFLICT ไม่ match unique constraint) — เป็นปัญหา schema ของงาน
Multi-branch support ที่ทำคู่ขนานกันอยู่ ไม่เกี่ยวกับ auth/session/middleware เลย ยืนยันด้วยการรัน
test เดิมกับ deployment **ก่อน** commit ของ middleware (`e652074`, ผ่าน URL เฉพาะของ deployment นั้น
ตรงๆ ไม่ใช่ alias) — fail เหมือนกันทุกประการ (error code เดียวกัน) พิสูจน์ว่า middleware ไม่ได้
เพิ่ม/เปลี่ยน failure mode นี้เลย

**Constraint ที่ทำตาม:** ไม่แตะ/ทำให้ `RequireAuth.js` อ่อนลง, ไม่แตะ branch `main`/production
systemd service, ไม่ gate `/share/customer/[token]/**` โดยไม่ตั้งใจ (ตรวจแล้วว่ายังเข้าได้ปกติทั้ง
page และ API), push ผ่าน `git pull --rebase` ตอนโดน reject จาก commit คู่ขนานของงาน Multi-branch
(ไม่ใช้ force push)

### 30. คืนวันที่ 24 ก.ค. 2026 — Supabase Security Advisor batch: ปิด RLS bypass บน `parts` +
accounting RPC ไม่เช็คสิทธิ์ + hygiene grants/search_path/storage

ที่มา: Notion card `3a7f39f45649817c85a3c1e2feca40dc` ("🔴 P0: Supabase Security Advisor batch") —
รัน `get_advisors(type=security)` บน staging (`qmqabtrrubqcmafietsr`) ก่อนเริ่มงานจริงพบ 123
findings (ต่างจากตัวเลข "70+" ที่การ์ดเขียนไว้ตอนเช้า เพราะ Multi-branch support + Accounting
Module landed schema เพิ่มระหว่างวัน) — ส่วนใหญ่เป็น hygiene noise แต่ 2 รายการยืนยันแล้วว่า
exploit ได้จริงด้วย live PoC บน staging (rollback ทุกครั้ง ไม่มีอะไรค้างจริง):

**P0-1 (RLS):** policy `"estimated_value floor on insert/update"` บนตาราง `parts` เป็น PERMISSIVE
แทนที่จะเป็น RESTRICTIVE ที่ตั้งใจไว้ — Postgres รวม PERMISSIVE ด้วย OR ทำให้ floor (จำกัดว่าต้องเป็น
owner/manager/supervisor/admin ถึงจะตั้ง `estimated_value` ได้) ไม่บังคับใช้เลย ยืนยันด้วย live PoC:
technician ตั้งค่านี้ในอะไหล่ของอู่ตัวเองผ่านได้ตรงๆ — ประวัติที่มา: เคยถูกแก้ถูกต้องเป็น
`as restrictive` แล้วครั้งหนึ่งใน `salvage_vehicle_cost_allocation_migration.sql` แต่ถูก
`multi_branch_support_migration.sql` (section 9, ที่มีคอมเมนต์พูดถึงบั๊กคลาสเดียวกันนี้ตรงๆ
ประชดในตัว) DROP+CREATE ใหม่แบบไม่มี `as restrictive` ตอนเพิ่ม branch_id clause เข้าไป จึง regress
กลับไปเป็น PERMISSIVE โดยไม่ตั้งใจ — แก้กลับเป็น RESTRICTIVE (คง branch_id clause เดิมไว้ครบ)

**P0-2 (RPC authorization):** 5 ฟังก์ชัน `SECURITY DEFINER` ในโมดูลบัญชี
(`fn_insert_system_journal_entry`, `fn_get_or_open_period`, `fn_backfill_current_period_sales`,
`fn_recalc_stock_cap_status`, `fn_seed_default_chart_of_accounts`) รับ `p_shop_id` จากผู้เรียกตรงๆ
โดยไม่เช็ค `is_shop_member()` เลย ยืนยันด้วย live PoC: technician ร้าน A ยิง RPC ตรงใส่ `p_shop_id`
ร้าน B สำเร็จ ทั้งฉีด journal entry ปลอม ฿9,999,999 เข้าบัญชีร้านอื่น และเปิดงวดบัญชีใหม่ให้ร้านอื่น
— เติม `is_shop_member()` check ทุกตัว โดย role-set ต่อฟังก์ชันอิงจาก **caller จริงของฟังก์ชันนั้น**
ไม่ใช่ copy จาก `close_accounting_period` เหมือนกันหมด (ดูเหตุผลละเอียดใน SOP.md ส่วน
"Security Advisor batch" และคอมเมนต์ในไฟล์ migration) — 3 ใน 5 ฟังก์ชัน
(`fn_insert_system_journal_entry`/`fn_get_or_open_period`/`fn_recalc_stock_cap_status`) ถูกเรียกจาก
trigger chain ที่ทำงานได้ทั้งจาก end-user จริงและจาก service-role เขียนตรง (`auth.uid()` เป็น null)
— ใช้ `auth.uid() is not null and not is_shop_member(...)` แทน blanket check เพื่อไม่พัง
service-role-driven flow พร้อม revoke EXECUTE จาก `anon` เพิ่มเพื่อปิดช่องที่ auth.uid() เป็น null
ได้เหมือนกันสำหรับผู้ใช้ที่ไม่ login เลย

**P1 (revoke grants + search_path):** revoke EXECUTE ฟังก์ชัน trigger-only 7 ตัวตามการ์ด + 1 ตัว
เพิ่มที่เจอระหว่างตรวจ (`trg_autofill_branch_id`, มาจาก Multi-branch support หลังการ์ดเขียนเสร็จ)
จาก `anon`/`authenticated` — พบว่า `revoke ... from anon, authenticated` เฉยๆ **ไม่พอ** เพราะฟังก์ชัน
เหล่านี้ grant ให้ PUBLIC มาตั้งแต่สร้าง (default ของ Postgres) ต้อง `revoke ... from PUBLIC, anon,
authenticated` เสมอ (ตรงกับ convention ที่ `db/car_data_rpc_revoke_public_access_migration.sql`
วางไว้แล้ว) ยืนยันผลทุกครั้งด้วย `has_function_privilege()` ไม่ใช่แค่เชื่อว่า statement รันผ่าน — และ
`alter function ... set search_path = public` ให้ครบ 18 ฟังก์ชันตาม advisor list ปัจจุบัน (ไม่ใช่
list เดิมจากการ์ด เพราะมีฟังก์ชันจาก Multi-branch support เพิ่มมา ตรวจ signature จริงก่อนรันทุกตัว)

**P2 (ทำ):** ตัด policy `"Allow public read photos"` บน `storage.objects` (bucket `part-photos`)
ออก — bucket เป็น public bucket อยู่แล้ว (`getPublicUrl()` bypass RLS ตรงๆ ผ่าน endpoint
`/storage/v1/object/public/...` โดยไม่ต้องมี policy เลย) โค้ดแอปจริงก็ไม่เคยเรียก `.list()` เลย
policy เดิมให้แค่สิทธิ์ enumerate ไฟล์ทั้ง bucket เท่านั้นที่ตัดออกไปได้โดยไม่กระทบอะไร

**P2 (ไม่ทำรอบนี้, ตั้งใจ):** ย้าย `ltree` extension ออกจาก `public` schema — extension นี้ติดตั้ง
operator/function ทั้งชุด (60+ objects) ไว้ใน `public` ไม่ใช่แค่ type ย้ายจริงต้องปรับ `search_path`
ของ `zones_set_path`/`zones_update_path` เป็น `public, extensions` คู่กันในการ์ดเดียว เสี่ยงพังฟีเจอร์
zone hierarchy ถ้าไม่มี test window แยก — แนะนำเปิดการ์ดใหม่ทำเฉพาะเรื่องนี้ + เปิด "Leaked password
protection" ต้องทำผ่าน Supabase Dashboard เอง (ไม่มี dashboard UI access จาก environment นี้)

**Migration:** `db/security_advisor_batch_fixes_migration.sql` (idempotent, มีเหตุผลของ
role-set/PUBLIC-grant/auth.uid()-null ต่อฟังก์ชันอธิบายไว้ในไฟล์ครบ)

**Test:** `qa-automation/tests/security-advisor-batch-fixes.spec.js` (ใหม่, 14 tests) —
cross-shop parts write (INSERT+UPDATE) ถูกบล็อกจริง, cross-shop journal injection/period-open/
backfill/recalc/seed ถูกบล็อกจริงทั้ง 5 ฟังก์ชัน, ผู้ใช้ไม่ login เลย (anon key เปล่า) ถูกบล็อกที่
grant level, positive control ของทุก role ที่ควรผ่านยังผ่านปกติ (รวม technician/assistant ที่ยัง
ต้องบันทึกยอดขายได้ตามปกติ) — ผ่านหมดบน staging จริง ก่อน/หลัง `get_advisors` ยืนยัน finding ที่แก้
หายไปครบ (`function_search_path_mutable`, `rls_policy_always_true`,
`public_bucket_allows_listing` = 0 รายการ) รวม 123 -> 80 findings

**Regression sweep:** `accounting-module-core.spec.js` (12/12 — พบ+แก้ regression ระหว่างทาง: เช็ค
แบบ blanket พัง ACC-004 เพราะ insert `part_sales` ผ่าน service role มี `auth.uid()` null ก่อนแก้เป็น
`auth.uid() is not null and ...`), `db-rls.spec.js` (9/9), `stock-summary-report.spec.js` (11/11),
`multi-branch-support.spec.js` (10/11, 1 fail ไม่เกี่ยวข้อง — ดูล่าง)

**Known, ไม่เกี่ยวข้องกัน (ยืนยันแล้ว):** `multi-branch-support.spec.js` TC-MB-3a fail ด้วย
`AuthApiError: invalid JWT ... unrecognized JWT kid` ตอนเรียก `auth.admin.createUser()` — ปัญหา JWT
signing key ของ environment เอง (เห็น warning เดียวกันซ้ำๆ ใน global-setup ทุกรัน ทั้งก่อนและระหว่าง
การแก้ครั้งนี้ ไม่ใช่ผลจาก migration นี้)

**Constraint ที่ทำตาม:** ไม่แตะ branch `main`/production systemd service (การ์ดยืนยันเองว่าเป็น
staging-only exposure), ทุก live PoC รันใน transaction แล้ว rollback เสมอ ไม่มีข้อมูลค้าง, ไม่ force
push
