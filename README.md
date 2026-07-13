# ระบบสต็อกอะไหล่รถ (MVP)

หน้าที่มี 6 หน้า:
- `/` — ดูรายการ + ค้นหา/filter (ยี่ห้อ, ชื่ออะไหล่, โซนแบบ dropdown) — คลิกการ์ดเพื่อแก้ไข
- `/add` — เพิ่มอะไหล่ใหม่ (ถ่ายรูป + กรอกข้อมูล + เตือนถ้าปีนอกช่วงรุ่น)
- `/edit/[id]` — แก้ไขข้อมูล / เปลี่ยนรูป (คลิกขยายได้) / ลบอะไหล่
- `/admin` — หน้ารวมตั้งค่าระบบ
- `/admin/zones` — จัดการรายการโซนจัดเก็บ (เพิ่ม/ลบ)
- `/admin/options` — จัดการ สภาพ/ที่มา/สถานะ (เพิ่ม/ลบ)

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

## วิธีรันโปรเจกต์

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
│   ├── layout.js       ← layout หลัก
│   ├── globals.css     ← สไตล์
│   ├── page.js         ← หน้าแรก (list + search)
│   ├── add/
│   │   └── page.js     ← หน้าเพิ่มอะไหล่
│   ├── edit/
│   │   └── [id]/
│   │       └── page.js ← หน้าแก้ไข/ลบอะไหล่ (คลิกรูปขยายได้)
│   └── admin/
│       ├── page.js         ← หน้ารวมตั้งค่า
│       ├── zones/
│       │   └── page.js     ← จัดการโซนจัดเก็บ
│       └── options/
│           └── page.js     ← จัดการ สภาพ/ที่มา/สถานะ
├── components/
│   └── CarAutocomplete.js  ← ช่องค้นหายี่ห้อ/รุ่น/ปี (autocomplete)
├── lib/
│   ├── supabaseClient.js
│   ├── carModels.json      ← ฐานข้อมูลรถ 311 รุ่น 40 ยี่ห้อ (รวมรถนำเข้า JDM)
│   ├── yearValidation.js   ← เช็คปีนอกช่วงที่รุ่นผลิต
│   └── zoneStorage.js      ← จำโซนล่าสุดที่เลือก (localStorage)
├── package.json
├── next.config.mjs
└── .env.local.example
```

## ฟีเจอร์ Autocomplete ยี่ห้อ/รุ่น/ปี
พิมพ์ 2 ตัวอักษรขึ้นไปในช่อง "🔍 ค้นหารถ" — ระบบค้นหาจากทั้งชื่อยี่ห้อและรุ่นพร้อมกัน (เช่น พิมพ์ "camry" หรือ "โต" ก็เจอ) เลือกแล้วจะเติมช่องยี่ห้อ/รุ่น/ปี (ปีเริ่มผลิต) ให้อัตโนมัติ — ยังแก้เองในช่องด้านล่างได้ถ้าไม่ตรง หรือไม่มีในฐานข้อมูล (รวมรถนำเข้า JDM เช่น Estima, Elgrand, Fuga ด้วยแล้ว)

## ฟีเจอร์ตรวจสอบปีรถ
ถ้ากรอกปีที่อยู่นอกช่วงที่รุ่นนั้นผลิตจริง (เทียบจาก dataset) จะขึ้นคำเตือนสีเหลืองใต้ช่องทันที (ยังกรอกต่อได้) และตอนกด "บันทึก" จะมี popup ถามยืนยันอีกครั้งก่อนบันทึกจริง

## ฟีเจอร์ถ่ายรูปจากมือถือ
ปุ่ม "📷 ถ่ายรูปอะไหล่" เปิดกล้องมือถือโดยตรง (ไม่ต้องผ่านตัวเลือกไฟล์ระบบ) ถ่ายเสร็จรูปจะขึ้น preview ในหน้าทันทีอัตโนมัติ ในหน้าแก้ไข คลิกที่รูป preview เพื่อขยายดูแบบเต็มจอได้ (คลิกซ้ำเพื่อปิด)

## ฟีเจอร์จัดการโซนจัดเก็บ (Admin)
หน้า `/admin/zones` ใช้เพิ่ม/ลบรายชื่อโซนที่มีจริงในอู่ (เช่น JP-A1, EU-B3) พอมีโซนในระบบแล้ว หน้าเพิ่ม/แก้ไขอะไหล่จะเปลี่ยนจากช่องพิมพ์อิสระเป็น dropdown เลือกจากลิสต์นี้แทน — และจะ**จำโซนล่าสุดที่เลือกไว้เป็นค่า default** สำหรับเพิ่มอะไหล่ชิ้นถัดไป จนกว่าจะเปลี่ยนเอง (สะดวกเวลาต้องเพิ่มอะไหล่หลายชิ้นจากโซนเดียวกันติดกัน) หน้าแรกก็ filter ตามโซนแบบ dropdown เดียวกันนี้ด้วย

## ฟีเจอร์จัดการ สภาพ/ที่มา/สถานะ (Admin)
หน้า `/admin/options` ใช้เพิ่ม/ลบตัวเลือกในแต่ละหมวด (สภาพ, ที่มา, สถานะ) แทนที่จะ hardcode ไว้ในโค้ด — เพิ่มตัวเลือกใหม่ได้ทันทีโดยไม่ต้องแก้โค้ด


## ทดสอบว่าใช้ได้จริง
1. เปิด `/add` → ถ่ายรูป (หรือเลือกไฟล์) + กรอกชื่ออะไหล่ → กด "บันทึกอะไหล่"
2. จะเด้งกลับหน้าแรกอัตโนมัติ เห็นรายการที่เพิ่งเพิ่ม
3. ลองพิมพ์ค้นหา/เลือก filter ยี่ห้อ/โซน ดูว่ากรองถูกต้อง

## ยังไม่ทำใน MVP นี้ (ตามที่ตกลงกันไว้)
- ❌ Login / role แยกสิทธิ์
- ❌ AI auto-post ไปโซเชียล
- ❌ ระบบขาย/ชำระเงิน
- ❌ ข้อมูลลูกค้า (เก็บแยกจากระบบนี้โดยเจตนา)
