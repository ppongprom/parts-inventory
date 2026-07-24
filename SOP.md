# SOP คู่มือการทำงาน — Parts Inventory System

> เอกสารนี้คือ **ขั้นตอนทำงานจริงวันต่อวัน** (day-to-day operating procedure) สำหรับทีมงานหน้างาน
> (เจ้าของ/ผู้จัดการ/หัวหน้างาน/ช่าง/ผู้ช่วยช่าง) — ไม่ใช่ spec สำหรับ dev
>
> **ขอบเขต:** เอกสารนี้บอกว่า "ต้องทำอะไรก่อน-หลัง" ส่วนรายละเอียดว่า "แต่ละบทบาท (role) ทำอะไรได้บ้าง"
> หรือ "ปุ่มไหนกดแล้วเกิดอะไร" ดูที่ `USER_MANUAL.md` แทน (แก้ไข 21 ก.ค. 2026 — เอกสารนี้เคยบอกว่า
> User Manual ยังเป็น draft ไม่มีไฟล์แยก แต่ตรวจพบว่ามีไฟล์ `USER_MANUAL.md` อยู่ในโปรเจกต์แล้วจริง
> ตั้งแต่ 20 ก.ค. 2026)
>
> **สถานะ:** ✅ ใช้งานได้จริงแล้ว (verify กับโค้ดจริงในโปรเจกต์ วันที่ 20 ก.ค. 2026) / 🔜 ออกแบบ
> ไว้แล้ว รอสร้าง (มีการ์ดใน backlog) / ❌ ยังไม่มีเลย ยังไม่ได้ออกแบบ
>
> **หมายเหตุความถูกต้องของเอกสารนี้:** การ์ด Notion เดิมระบุว่ามีการสร้างไฟล์นี้ไปแล้วเมื่อ
> 19 ก.ค. 2026 แต่ตรวจสอบ git ทั้ง `main` และ `staging` แล้ว**ไม่พบไฟล์นี้ในโปรเจกต์เลย** (ไม่มี
> ประวัติ commit ใดๆ) — เข้าใจว่างานนั้นอาจทำไว้ในเซสชันอื่นแต่ไม่ได้ commit ไว้จริง เอกสารนี้จึงเป็น
> การสร้างใหม่ทั้งหมด โดยอิงจากการตรวจโค้ดจริงในระบบ ณ วันที่ 20 ก.ค. 2026

---

## 1. รับอะไหล่เข้าระบบ (`/add`) — ✅ ใช้งานได้จริง

1. เปิดหน้า **+ เพิ่มอะไหล่ใหม่** (`/add`)
2. ถ่ายรูป หรือ เลือกจากคลังภาพ (อย่างน้อย 1 รูป, เพิ่มได้หลายรูป)
   - ⚠️ **มือถือ Android:** ถ้าเปิดแอปกล้องแล้วแอปหน้านี้ถูกปิดกลางคัน (เครื่องแรงดันหน่วยความจำสูง)
     ระบบจะกู้คืนฟอร์ม+รูปที่กรอกไว้ให้อัตโนมัติเมื่อกลับเข้าหน้าใหม่ พร้อมข้อความแจ้งเตือน — ไม่ต้องเริ่มใหม่ทั้งหมด
3. เลือกประเภท: 🔧 อะไหล่ถอด หรือ 🧴 ของสิ้นเปลือง
4. กรอกชื่อชิ้นส่วน, ค้นหารถ (ยี่ห้อ/รุ่น — เลือกจากรายการที่ระบบค้นเจอเท่านั้น ห้ามพิมพ์เอง
   เพื่อกันข้อมูลปี/รุ่นเพี้ยน — ถ้าไม่เจอรุ่นที่ต้องการ แจ้งแอดมินให้เพิ่มในฐานข้อมูลก่อน)
5. เลือกสภาพ/ที่มา, เลือกโซนจัดเก็บ (ถ้ามีระบบโซนแล้ว — ดูข้อ 2), กรอกจำนวน/ราคา/เลขที่อะไหล่ (ไม่บังคับ)
6. กด **บันทึกอะไหล่**

**สแกน QR โซนแทนการเลือกจากช่องค้นหา:** ✅ **เพิ่งทำเสร็จคืนนี้ (21 ก.ค. 2026)** — กดปุ่ม
"📷 สแกนตำแหน่งแทน" ใต้ช่องค้นหาโซนในหน้า `/add` และ `/edit/[id]` ได้เลย เปิดกล้องสแกน QR โซนแล้ว
auto-fill ให้ทันที ไม่ต้องอ้อมไป `/zone/[id]` ก่อนอีกต่อไป — สแกนได้เฉพาะโซนปลายทาง (leaf) เท่านั้น
เหมือนเดิม ถ้าสแกน QR โซนที่มีโซนย่อยข้างใน ระบบจะแจ้งเตือนให้สแกนชั้น/ตำแหน่งที่ลึกที่สุดแทน
ไม่ auto-fill ให้ (ต้องใช้เบราว์เซอร์ที่รองรับ BarcodeDetector — Android Chrome รองรับ)
**toggle "บังคับสแกน QR ยืนยันตำแหน่ง" ระดับร้าน:** ✅ **ใช้งานได้จริงแล้ว** (แก้ไข 21 ก.ค. 2026 —
เอกสารนี้เคยบอกว่ายังไม่ได้ทำ แต่ตรวจโค้ดจริงพบว่าทำเสร็จไปแล้วพร้อมกับการ์ด "ย้ายอะไหล่ระหว่าง
Zone") เปิด/ปิดได้ที่ `/admin` (default ปิด) — ปิด: ปุ่มสแกนเป็นแค่ทางเลือกเสริม พิมพ์ค้นหาเองได้ตาม
ปกติ / เปิด: ซ่อนช่องค้นหาด้วยมือ บังคับต้องสแกน QR เท่านั้นถึงจะบันทึกตำแหน่งได้ ใช้ผลเดียวกันทั้งที่
`/add`, `/edit/[id]`, และ `/move-part/[id]`

---

## 2. จัดเก็บ/ค้นหาในสต็อก (โซน / Area → Rack → Level) — ✅ ใช้งานได้จริง

1. โครงสร้างโซนเป็นลำดับชั้น Area → Rack → Level (`/admin/zones` จัดการ, แสดงเป็น expandable tree)
2. พิมพ์ QR label ของแต่ละโซนได้ที่ `/print-zone-labels` (ขนาดจริง 40×60mm ตรงกับสติกเกอร์ที่ใช้พิมพ์จริง)
3. ย้ายอะไหล่จำนวนมากพร้อมกันข้ามโซน ใช้หน้า `/move-parts` — ระบบบังคับปลายทางต้องเป็น
   **leaf zone** เท่านั้น (โซนที่ไม่มีลูกซ้อนอยู่ข้างใน) กันเผลอเก็บของไว้ที่ระดับ Area/Rack เฉยๆ
4. ค้นหาอะไหล่ในสต็อกผ่านหน้ารายการหลัก — กรองตามโซนได้ (dropdown เรียงตามลำดับชั้นจริง)

**อะไหล่เก่าที่ยังไม่มี zone_id (ก่อนมีระบบ hierarchy):** ✅ **ใช้งานได้จริงแล้ว** (แก้ไข
21 ก.ค. 2026 — เอกสารนี้เคยบอกว่ายัง "รอสร้าง" แต่ตรวจโค้ดจริงพบว่าเครื่องมือนี้ทำเสร็จไปแล้วตั้งแต่
คืนก่อน) ที่หน้า `/move-parts` เลือกต้นทางเป็น "📦 อะไหล่ที่ยังไม่มีโซนเลย (ของเก่าก่อนมีระบบโซน)"
ได้เลย ไม่ต้องแก้ทีละชิ้นผ่านหน้า edit อีกต่อไป — ครอบทั้งเคสไม่มี zone_code เลยและมี zone_code
เดิม (text) แต่ไม่มี zone_id

**ความคืบหน้าเพิ่มเติมคืนนี้ (21 ก.ค. 2026):** โครงสร้าง ltree ทั้งหมด (parent_id/path/trigger
รักษา path+กันวงจร/unique code ต่อ parent) เคย live บน staging จากเซสชันก่อนแต่ไม่เคย commit —
export กลับเป็น `db/zone_hierarchy_ltree_migration.sql` แล้ว พร้อม trigger ใหม่ที่กันไม่ให้ตั้ง
parent_id ข้ามร้าน (ช่องโหว่ multi-tenant ที่เพิ่งพบ) และแก้บั๊กหน้า `/admin/zones` ที่เดิมบล็อกการลบ
โซนแม้ของข้างในจะขายหมดแล้ว (quantity = 0) — ตอนนี้นับเฉพาะของที่ยัง quantity > 0 จริงเท่านั้น

---

## 3. ขายอะไหล่ — ✅ ใช้งานได้จริงแล้ว (ระบบตะกร้า — เพิ่งทำเสร็จคืนนี้ 21 ก.ค. 2026)

**ขั้นตอน:**
1. หน้ารายการอะไหล่ (`/`) กดปุ่ม **"🛒 เลือกขาย"** (คู่กับ "🏷️ เลือกพิมพ์ QR" เดิม — เลือกโหมดใดโหมด
   หนึ่งเท่านั้น สลับโหมดจะเคลียร์ของที่เลือกไว้ทันที)
2. แตะเลือกอะไหล่ที่จะขายได้หลายชิ้น ข้ามหน้าได้ (เลื่อนหน้าแล้วกลับมาเลือกเพิ่มได้ ของที่เลือกไว้
   ไม่หาย)
3. กด **"🛒 ไปหน้าขาย (N ชิ้น)"** ไปหน้า `/checkout` — แก้จำนวน/ราคาขายต่อชิ้นได้ (ค่าเริ่มต้น =
   จำนวนคงเหลือทั้งหมด), ลบออกจากตะกร้าได้ทีละชิ้น, กรอกชื่อ/เบอร์ผู้ซื้อ (ใช้ร่วมกันทั้งตะกร้า)
   และ **ต้องเลือกวิธีชำระเงินก่อนยืนยันเสมอ** (ดูข้อ 4)
4. กด **"✓ ยืนยันการขายทั้งหมด"** — ระบบตัดสต็อกทันทีทีละชิ้น แต่ละชิ้นเป็นอิสระต่อกัน (ถ้าชิ้นใด
   ขายไม่สำเร็จเช่นสต็อกชนกันพอดี ชิ้นอื่นที่สำเร็จแล้วจะไม่ถูกยกเลิกตาม — เหมือนออเดอร์แยกกันของ
   Shopee/Lazada) แสดงผลสรุปเป็น "ขายสำเร็จ N/M ชิ้น" พร้อมเหตุผลของชิ้นที่ไม่สำเร็จ
5. ระบบแสดง **Picking List** ของชิ้นที่ขายสำเร็จ — ถ้าหยิบของจริงแล้วหาไม่เจอ/เสียหาย กดปุ่ม
   "หาไม่เจอ / ของเสียหาย (คืนสต็อก)" ได้ทีละชิ้น (คืนจำนวนกลับเข้าสต็อกอัตโนมัติ ไม่กระทบชิ้นอื่น)
6. กด **"✓ Confirm Pick เสร็จ — ส่งมอบลูกค้าหน้าร้านทันที"** เพื่อปิดออเดอร์แบบ walk-in — ระบบออก
   **ใบเสร็จ** ให้อัตโนมัติตรงจุดนี้ (ไม่ใช่ตอนยืนยันขาย) พร้อมเลขที่เอกสาร

**ยังไม่ทำ (รอบนี้จงใจจำกัดขอบเขต — ดูรายละเอียดใน `db/cart_based_selling_flow_migration.sql`):**
Pack/Ship แบบเต็มรูป (ออเดอร์จัดส่งที่ไม่ใช่ walk-in), ใบกำกับภาษีเต็มรูป (ตอนนี้ออกได้แค่ใบเสร็จ),
โอนอะไหล่ข้ามสาขาอัตโนมัติตอน confirm pick (รอ Multi-branch support ที่ยังไม่เริ่ม)

**ขายของที่ยังไม่ตีราคา + แก้ราคาต้นทุน/ขายตอน checkout:** ✅ ใช้งานได้จริงแล้ว (เสร็จ 24 ก.ค. 2026)

นำ Maker-Checker กลาง (ข้อ 10) มาขยาย action_type ใหม่ `sell_unpriced_part` แทนสร้างระบบคู่ขนาน —
ที่หน้า `/checkout` แก้ `allocated_cost` ต่อชิ้นได้ (บันทึกลง audit_log ทั่วไปอัตโนมัติ ไม่ต้องมี
กลไกแยก) และขายของที่ยังไม่มีราคาได้เสมอ (ตัดสต็อกทันที) — ถ้าร้านเปิด Approval Flow ไว้
(ปิด default) ธุรกรรมจะเข้าคิว `pending_approval` ไม่นับเข้ารายงาน/Stock Value Cap จนกว่าจะอนุมัติ

**✅ ตัดสินใจครบแล้ว 24 ก.ค. 2026 (คุณอั้มตอบคำถามที่ค้างในการ์ดทั้งหมด — implement เสร็จแล้ว ตรง 100% ตามที่ตัดสินใจ):**
- ระหว่างรออนุมัติ (pending_approval) **ไม่นับเข้า Stock Value Cap / Stock Summary Report จนกว่าจะอนุมัติผ่าน**
- ถ้าผู้อนุมัติกด **"ปฏิเสธ"** — **คงสถานะขายไว้ตามเดิม ไม่คืนสต็อก** แค่แจ้งเตือนเจ้าของร้านให้ไปดู
- แก้ allocated_cost ตอน checkout ถือเป็น **correction เฉพาะจุด** ไม่ต้อง reconcile ให้ผลรวมเท่า
  purchase_price ทั้งคัน (invariant ของการ์ด Salvage cost allocation ใช้แค่ตอน allocate ครั้งแรกเท่านั้น)
- **Self-approval อนุญาต** — owner ขายเองแล้วอนุมัติเองได้ (ร้านเล็กมีคนเดียวทำทุกอย่าง ไม่บล็อก)

---

## 4. รับชำระเงิน — ✅ ใช้งานได้จริงแล้ว (แก้ไข 21 ก.ค. 2026 — เดิมบอกว่ายังไม่มี)

ทุกการขาย (ทั้งขายทีละชิ้นที่ `/edit/[id]` และขายผ่านตะกร้าที่ `/checkout`) **บังคับเลือกวิธีชำระเงิน
ทุกครั้ง** ไม่ default ไปที่ค่าใดค่าหนึ่งเงียบๆ — ตัวเลือก: เงินสด / โอนเงิน / บัตร / อื่นๆ

**ยังไม่ทำ:** เชื่อมกับผังบัญชี (mapping payment_method → account_code เช่น เงินสด → 1010100)
— รอการ์ด Accounting Module ที่ยังไม่เริ่มสร้าง

---

## 5. ออกใบเสร็จ/ใบกำกับภาษี — ✅ ใช้งานได้จริงทั้งฝั่งงานซ่อมและฝั่งขายอะไหล่ (receipt เท่านั้น)

- **งานซ่อม (jobs):** มีระบบเอกสาร/ลายเซ็นต์ที่ `/jobs/[id]/documents` — รองรับใบแจ้งหนี้ตาม
  ข้อกำหนดกรมสรรพากร มาตรา 86/4 แล้ว (ดู README หัวข้อ 14)
- **ขายอะไหล่ผ่านตะกร้า (ไม่ผูกกับ job):** ✅ **ใช้งานได้จริงแล้ว** (แก้ไข 21 ก.ค. 2026 — เดิมบอกว่า
  ยังไม่มี) — ออกใบเสร็จอัตโนมัติตอนกด "Confirm Pick เสร็จ" ที่ `/checkout` (ดูข้อ 3) แช่แข็งรายการ/
  ราคา/ผู้ซื้อ/วิธีชำระเงิน ณ ตอนออกเอกสาร แก้ข้อมูลอะไหล่ทีหลังไม่กระทบเอกสารเดิม
  **ยังไม่ทำ:** ใบกำกับภาษีเต็มรูป (ต้องมีเลขผู้เสียภาษีลูกค้า) — ออกได้แค่ใบเสร็จธรรมดารอบนี้

---

## 6. บันทึกบัญชี / ปิดงวด — 🟡 ทำแล้วบางส่วน (Accounting Module — scoped-down first pass, 24 ก.ค. 2026)

การ์ดนี้เป็น XL (ใหญ่ที่สุดในระบบ) — รอบนี้ทำเฉพาะ core ledger mechanics เท่านั้น ไม่ใช่ทั้งการ์ด:

✅ **ทำแล้ว (verify ผ่าน Supabase MCP บน staging + Playwright จริงแล้ว):**
- ผังบัญชี 7 หลัก (`accounting_accounts`) — seed มาตรฐาน 9 บัญชีอัตโนมัติตอนเปิดโมดูลต่อร้าน
- `journal_entries`/`journal_entry_lines` — invariant Σ debit = Σ credit บังคับตั้งแต่ insert
  (reject ทันทีถ้าไม่สมดุล) ผ่าน RPC `create_journal_entry()` (mirror ของ Platform Revenue
  Module's `create_platform_journal_entry()`)
- Audit trail ของ journal entries — ผูกกับ `fn_audit_row_change()` กลางที่มีอยู่แล้ว (ใครสร้าง/แก้
  เมื่อไหร่ ผ่าน `changed_by_user_id`/`created_at`)
- Event rule ขาย "own" (เจ้าของเอง): แยก Dr เงินสด-ธนาคาร (cash/bank_transfer/card/other) vs
  Dr ลูกหนี้การค้า (payment_method='credit', ขายเชื่อ) + Cr รายได้ + Cr VAT output + ตัด COGS
  (ใช้ `coalesce(allocated_cost, price, 0)` ตาม convention เดิมของระบบ)
- Event rule ขาย "consignment" (ฝากขาย): Agent model ตาม TFRS15/IFRS15 — Dr เงินสด/ธนาคารเต็มยอด /
  Cr เจ้าหนี้ผู้ฝากขาย (ยอด−ค่าคอมมิชชั่น) + Cr รายได้ค่าคอมมิชชั่น — **ไม่มี COGS เลย** ตาราง
  `consignors` ใหม่เก็บ `default_commission_rate` ต่อผู้ฝาก + `parts.commission_rate_override`
  override รายชิ้นได้
- VAT ออกที่วันขายจริง (pack date/ส่งมอบลูกค้า — `item_status='completed'`) ตามที่ตัดสินใจไว้แล้ว —
  อัตรา 7% (`fn_vat_rate()` ฝั่ง DB + `config/accountingConfig.js` VAT_RATE ฝั่งแอป)
- `accounting_periods` (ปิดงวดรายเดือน) — post entry เข้างวดที่ปิดแล้ว → reject ทันที เปิดช่อง
  `fn_is_period_closed(shop_id, date)` ให้ฟีเจอร์อื่น (เช่น NRV check ของ Salvage cost allocation)
  hook ต่อได้โดยไม่ต้องรู้ internal
- Enable/disable module ต่อร้าน (`shops.accounting_module_enabled`) — ปิด (default): ขายบันทึก
  `part_sales` ปกติ ไม่มี journal เลย / เปิด: สร้าง journal อัตโนมัติเพิ่มจาก part_sales (ไม่ใช่
  แทนที่) + backfill รายการขายของ**งวดปัจจุบันที่ยังเปิดอยู่เท่านั้น** (งวดก่อนหน้าที่ปิดไปแล้ว
  ไม่แตะต้อง ตามมติที่ตัดสินใจไว้)
- Monetization gate — Pro tier ขึ้นไปเท่านั้น บังคับทั้งฝั่ง UI (`/admin`, `/admin/accounting`)
  และฝั่ง RPC เอง (`set_accounting_module_enabled()` เช็ค `subscription_plan` ก่อนเสมอ ไม่ใช่แค่
  UI ซ่อนปุ่ม)
- Informal report (`/admin/reports`) กับ formal ledger อ่านจากฐานข้อมูลชุดเดียวกัน (`part_sales`)
  ไม่ drift — verify ด้วย test ACC-012
- UI: `/admin/accounting` (ผังบัญชี + งวดบัญชี + journal entries, ปุ่มปิดงวด) + toggle เปิด/ปิดที่
  `/admin`
- Test: `qa-automation/tests/accounting-module-core.spec.js` (12 tests, ผ่านทั้งหมดบน staging)

🔜 **ยังไม่ทำ (deferred ตั้งใจ, มีเหตุผลชัดเจน ไม่ใช่ลืม):**
- **Intercompany/shop_groups/consolidation report** — blocked บน Multi-branch support ซึ่งยัง
  "Not started" ใน Notion จริง (verify แล้ว 24 ก.ค. 2026) ระบบมี `branches` table แล้วจริง (child
  table ของ shop เดียว ตาม Option A ที่การ์ด Multi-branch เลือกไว้) แต่ยังไม่มี `shop_groups`/
  แนวคิดอู่ในเครือข้ามคนละ shop_id เลย — ไม่เดา schema intercompany เอง รอการ์งนั้นก่อน
- **Investor model** (กิจการร่วมค้าแบ่งกำไร) — การ์ดต้นทางบอกไว้ตรงๆ ว่า "ยังไม่ได้ออกแบบ journal
  แยกต่างหาก" ไม่ใช่ agent/commission แบบ consignment — ไม่ implement
- **NRV check ผูกปิดงวด** — Edge Case 4 ของการ์ด Salvage cost allocation (แยกคนละการ์ด) —
  `fn_is_period_closed()` เปิดช่องให้ต่อได้แล้ว แต่ตัวเช็คเองยังไม่ทำในรอบนี้
- **UI สำหรับ "รับชำระ AR"/"จ่ายคืนผู้ฝากขาย"** — RPC มีแล้ว (`record_ar_payment_received()`,
  `record_consignor_payout()`) แต่ยังไม่ผูกหน้าจอ

Migration: `db/accounting_module_migration.sql`

---

## 7. ซื้อซากรถทั้งคัน → ถอดขายเป็นชิ้น (Salvage Vehicle) — ✅ ใช้งานได้จริงครบทั้ง 2 ครึ่งแล้ว

แก้ไข 21 ก.ค. 2026 — เอกสารนี้เคยบอกว่ายังไม่มีเลย แต่ตรวจโค้ดจริงพบว่าครึ่งแรกทำเสร็จไปแล้ว:

1. หน้า `/salvage-vehicles` → **"+ รับซากรถเข้าระบบ"** (`/salvage-vehicles/new`) — ถ่ายรูป, เลือกรถ,
   ราคาซื้อ, โซนจอด, แตกมูลค่าประเมินเป็น 4-6 กลุ่มบังคับ (แต่ละกลุ่มต้องมีมูลค่า > 0)
2. กด **"ถอดอะไหล่จากคันนี้"** จากหน้ารายละเอียดรถ (`/salvage-vehicles/[id]`) — ไปหน้า `/add` พร้อม
   ผูก `salvage_vehicle_id` ให้อัตโนมัติ (ทำงานคล้าย `?job_id=` เดิม) สถานะรถเปลี่ยนเป็น "กำลังถอด"
   อัตโนมัติทันทีที่ถอดชิ้นแรก

**✅ เพิ่มเสร็จคืนนี้ (22 ก.ค. 2026) — การปันส่วนต้นทุน (cost allocation):** เอกสารนี้เคยบอกว่า
"ยังไม่ทำ...การ์ดเองยังไม่ตัดสินใจกฎการปัดเศษ" แต่มติทั้งหมดถูกเคาะไปแล้วเมื่อ 21 ก.ค. และคืนนี้ implement
ตามครบแล้ว:
- ที่หน้า `/add` (เฉพาะตอนถอดจากซากรถ + เฉพาะ Owner/Manager/Supervisor) มีช่องกรอก **"มูลค่าประเมิน
  (บาท)"** ต่อชิ้น — ระบบคำนวณ `allocated_cost` ให้อัตโนมัติทันที = ราคาซื้อทั้งคัน ×
  (มูลค่าประเมินชิ้นนี้ / มูลค่าประเมินรวมทั้งคัน)
- แก้มูลค่าประเมินรวมทั้งคัน (ตอน intake) ไม่ได้แล้วหลังเริ่มถอดชิ้นแรก (freeze อัตโนมัติ)
- ปุ่ม **"🗑️ ขายซากที่เหลือ (เศษเหล็ก)"** ที่หน้ารายละเอียดรถ (Owner/Manager/Supervisor เท่านั้น) —
  สร้างรายการอะไหล่ "เศษเหล็ก" อัตโนมัติรับส่วนต่างที่เหลือทั้งหมด (กันเศษปัดตกหล่น) แล้วปิดคันเป็น
  "ถอดหมดแล้ว" ทันที ทำซ้ำไม่ได้
- `allocated_cost` ที่คำนวณได้จะไหลเข้า **Stock Value Cap Engine** (หัวข้อยอดสต็อกรวมของร้าน) และ
  **Export CSV** (คอลัมน์ `allocated_cost` ในไฟล์อะไหล่) อัตโนมัติด้วย ไม่ต้องทำอะไรเพิ่ม

**✅ เพิ่มเสร็จ 24 ก.ค. 2026 — 3 ใน 5 edge cases จากการ์ด "Salvage vehicle cost allocation — edge
cases to design for" (Notion page `3a1f39f456498194a822f5d39f7bf608`):**

1. **Write-off (edge case 1):** ✅ ทำไปแล้วก่อนหน้านี้ — ตรวจยืนยันคืนนี้ว่าอยู่บน `staging` จริงและ
   implement เป็น generic action บนตัว part ทุกชิ้นแล้ว (ไม่ผูกกับ salvage อย่างเดียว) — ปุ่ม
   "📉 ตัดเป็นค่าเสียหาย (Write-off)" ที่หน้า `/edit/[id]` ใช้ได้กับอะไหล่ทุกชิ้น บันทึก
   `write_off_reason`/`written_off_at`/`written_off_by` (`db/salvage_write_off_migration.sql`) —
   พร้อมให้การ์ด "โอนอะไหล่ข้ามสาขา" (ยังไม่เริ่ม) reuse mechanism เดียวกันได้ตามมติการ์ด
2. **ของแถมที่ไม่ได้ประเมินไว้ (edge case 2):** หน้า `/add` (ตอนถอดจากซากรถ) เว้นว่างช่อง
   "มูลค่าประเมิน" ได้อยู่แล้ว — แก้ trigger `fn_allocate_salvage_part_cost` ให้ชิ้นที่ผูก
   salvage_vehicle_id แต่ไม่กรอก estimated_value ได้ `allocated_cost = 0` เสมอ (ไม่ใช่ปล่อย null
   ค้างเหมือนก่อนหน้านี้) ต้นทุน 0 = กำไรเต็มราคาขาย ไม่กระทบอะไหล่ชิ้นอื่นในคันเดียวกันเลย
3. **ต้นทุนแรงงานถอด/ทำความสะอาด ผ่านใบงาน (edge case 3):** ที่หน้ารายละเอียดรถ
   (`/salvage-vehicles/[id]`) เพิ่มหัวข้อ **"🧰 ใบงานถอด/ทำความสะอาด"** — Owner/Manager/Supervisor
   สร้างใบงานได้ (scope, ระยะเวลาประมาณการ, ช่างที่รับผิดชอบ, อัตราค่าแรง/ชม.) และกดปิดงานได้
   (`db/salvage_vehicle_labor_cost_and_work_order_migration.sql`):
   - `labor_cost` = ระยะเวลาประมาณการ × อัตราค่าแรง (**ชั่วคราว**) ตอนสร้าง → เปลี่ยนเป็นเวลาจริง ×
     อัตราค่าแรง (**จริง**) อัตโนมัติตอนกด "✅ ปิดใบงาน"
   - `labor_cost` รวมกับ `purchase_price` เป็นฐานคำนวณ `allocated_cost` **ก่อน** ปันสัดส่วน (ตรงจุด
     เดียวกับที่ trigger เดิมคำนวณอยู่แล้ว ไม่ใช่ path คำนวณคู่ขนาน) — อะไหล่ที่คำนวณ allocated_cost
     ไปแล้วก่อนหน้า **ไม่ถูก recalculate ย้อนหลัง** เมื่อ labor_cost เปลี่ยนจากชั่วคราวเป็นจริงทีหลัง
     (สอดคล้องกับกฎ "freeze ตั้งแต่เริ่มถอดชิ้นแรก" เดิม)
   - 1 คันมีได้หลายใบงาน — `salvage_vehicles.labor_cost` sync อัตโนมัติเป็นผลรวมของทุกใบงาน
4. **NRV check ตอนปิดงวด (edge case 4)** — ❌ **ยังไม่ทำโดยตั้งใจ** (deferred, ไม่ใช่ลืม) —
   ต้องผูกกับ workflow ปิดงวดสิ้นเดือน (`accounting_periods`) ซึ่งเป็นส่วนของ Accounting Module ที่
   ยังไม่เริ่มสร้างเลย (ดูข้อ 6 ด้านบน) — รอ Accounting Module เริ่มก่อนถึงจะทำต่อได้
5. **ขายได้มากกว่าประมาณการ (edge case 5)** — ไม่ใช่ปัญหา ไม่ต้องมีโค้ดใหม่ (allocation คำนวณจาก
   สัดส่วนประมาณการ ไม่ใช่ราคาขายจริงอยู่แล้วโดยโครงสร้าง) — ล็อกพฤติกรรมนี้ไว้เป็น regression test
   แล้วเท่านั้น (กันใครมา "แก้ให้ฉลาดขึ้น" ทีหลังโดยไม่ตั้งใจ)

Test coverage ทั้งหมด (edge case 1, 2, 3, 5): `qa-automation/tests/card-salvage-vehicle-cost-allocation-edge-cases.spec.js`

---

## 8. การจัดการอู่ในเครือ / จัดการทีม — ✅ ใช้งานได้จริง

- **จัดการทีมในอู่ตัวเอง** (`/admin/team`): เชิญ/สร้างบัญชีพนักงาน (username+PIN หรือ อีเมล),
  เปลี่ยน role, ปิดใช้งาน/ลบสมาชิก, **รีเซ็ต PIN/รหัสผ่าน** ให้สมาชิกคนอื่น (ปุ่มในหน้านี้ ใช้ได้ทั้ง
  บัญชี username+PIN และบัญชีอีเมล)
- **ลืมรหัสผ่านของตัวเอง** (`/login` → "ลืมรหัสผ่าน?"): ส่งอีเมลลิงก์ตั้งรหัสผ่านใหม่ให้ตัวเอง
  ไม่ต้องพึ่งแอดมินรันสคริปต์อีกต่อไป ✅ **เพิ่งทำเสร็จคืนนี้ (20 ก.ค. 2026)**
- **Platform Admin** (`/platform-admin` — สำหรับทีมงานเจ้าของแพลตฟอร์มเท่านั้น ไม่ใช่เจ้าของอู่ลูกค้า):
  ดูรายชื่ออู่ทั้งหมด, แก้ subscription/billing, join-as-support เข้าอู่ลูกค้าเพื่อ debug
  - **✅ เพิ่งทำเสร็จคืนนี้ (20 ก.ค. 2026):** แบ่งระดับสิทธิ์ 3 ระดับแล้ว — Super Admin (ทำได้ทุกอย่าง),
    Support (join-as-support ได้ แก้ billing ไม่ได้), Analyst (ดูอย่างเดียว) — บังคับที่ระดับ API
    ทุก endpoint แล้ว ไม่ได้พึ่งการซ่อนปุ่มใน UI
  - **⚠️ แก้ไข 22 ก.ค. 2026 (nightly automation) — พบ 2 บั๊กจริงระหว่างตรวจสอบเอกสารนี้กับโค้ด/DB
    จริง ไม่ตรงกับที่เอกสารนี้เคยบอกว่า "ใช้งานได้จริง":**
    1. **Security:** ฟังก์ชัน RPC เบื้องหลัง (`platform_add_admin`/`platform_change_admin_role`/
       `platform_remove_admin`/`platform_join_as_support`/`platform_update_shop_subscription`)
       เชื่อพารามิเตอร์ role ที่ผู้เรียกส่งมาเองทั้งหมด **ไม่เคยเช็คสิทธิ์จริงจากฐานข้อมูลเลย** — ใครก็ตาม
       ที่เข้าถึง RPC endpoint ตรงได้ (ข้าม Next.js app) ยกระดับตัวเองเป็น super_admin ได้ทันที (ดูการ์ด
       Notion "🔴 P0: platform_change_admin_role..." สำหรับรายละเอียดเต็ม) — แก้แล้ววันนี้ (migration
       `db/platform_admin_rpc_auth_check_migration.sql`) ให้ฟังก์ชัน lookup role จริงจาก DB เอง
    2. **Functional:** `platform_audit_log.action` มี CHECK constraint ที่ไม่ตรงกับ action string
       ที่ 4 ใน 5 ฟังก์ชันข้างต้น insert จริง (ตรงแค่ `join_as_support`) — แปลว่า **เพิ่ม/ลบ/เปลี่ยน role
       admin และแก้ subscription/billing ทุกครั้งที่เรียกจริงผ่านแอป error 500 มาโดยตลอด** (audit log
       insert ไม่ผ่าน constraint → ทั้ง RPC transaction rollback) — แก้ action string ให้ตรงกับ
       constraint ในไฟล์เดียวกันแล้ว
    3. **สถานะ deploy:** แก้ที่ DB จริงบน staging แล้ว (ผ่าน Supabase MCP) แต่ code ฝั่ง route.js
       (ตัดพารามิเตอร์ role ที่ไม่ใช้แล้วออก) ยัง**ไม่ได้ push ขึ้น GitHub** (sandbox อัตโนมัติรอบนี้มีแค่
       สิทธิ์ read บน repo) — คุณอั้มต้อง apply commit `c03e29d` เอง ก่อนฟีเจอร์ join-as-support จะกลับมา
       ใช้งานได้ปกติ (ตอนนี้ signature ฝั่ง DB กับ route.js ไม่ตรงกันชั่วคราว)
  - **Activity Log** (ใครทำอะไรกับอู่ไหนเมื่อไหร่): ✅ ใช้งานได้จริงแล้ว — แก้ไข 21 ก.ค. 2026:
    เอกสารเดิมบอกว่ายังไม่มีหน้า UI แต่ตรวจโค้ดจริงพบว่ามีแท็บ "📜 Activity Log" ในหน้า
    `/platform-admin` แล้ว (ดู `app/platform-admin/page.js`) แสดง timeline พร้อม filter ฝั่ง client
    — เขียน+อ่าน log ผ่าน RPC เดียวกันแบบ transactional (mutation ไม่สำเร็จ = log ไม่ถูกเขียนด้วย)
  - **✅ เพิ่มใหม่ 23 ก.ค. 2026 — แท็บ "💰 Revenue"** ในหน้า `/platform-admin`: บัญชีของบริษัท
    Beam Garage เอง (คนละชุดกับบัญชีของอู่ลูกค้าโดยสิ้นเชิง — อู่ไม่มีทางเห็นข้อมูลนี้ได้เลย) ดู MRR/
    ARR รวม+แยกตาม tier, รายได้รับล่วงหน้าคงเหลือ, journal entries ตัวจริง (Analyst เห็นเต็มเท่า
    Super Admin — Support เห็นแค่สรุป dashboard) ปุ่ม "บันทึกรับชำระ subscription" (Super Admin
    เท่านั้น — ยังไม่มี payment gateway เชื่อมจริง ต้องกรอกมือ) และ "Recognize now" (รับรู้รายได้
    รับล่วงหน้าที่ถึงกำหนดทันที — ปกติรันอัตโนมัติทุกวัน 01:00 ผ่าน pg_cron อยู่แล้ว ปุ่มนี้ไว้กดดูผลสด
    ไม่ต้องรอ) **ขอบเขตรอบนี้:** subscription revenue เท่านั้น — ยังไม่ทำ commission (บล็อกด้วย
    ฟีเจอร์ marketplace ที่ยังไม่ออกแบบ) ช่อง "Commission" ในหน้า dashboard เป็น placeholder เฉยๆ

---

## 9. ติดตามสถานะงานที่ได้รับมอบหมาย (ในหน้า job) — ✅ ใช้งานได้จริง (เพิ่งทำเสร็จคืนนี้ 21 ก.ค. 2026)

ในหน้ารายละเอียดงาน (`/jobs/[id]`) หัวข้อ "📝 ขั้นตอนการทำงาน" — ทุกขั้นตอนย่อยของงานมีสถานะ
เดินตามลำดับนี้เท่านั้น (ข้ามขั้นไม่ได้):

```
มอบหมายแล้ว รอเริ่ม → (กด "▶️ เริ่มงาน") → กำลังทำ
กำลังทำ → (กด "⏸️ หยุดชั่วคราว" — ต้องกรอกเหตุผลเสมอ) → หยุดชั่วคราว
หยุดชั่วคราว → (กด "▶️ ทำต่อ") → กำลังทำ
กำลังทำ → (กด "✅ เสร็จงาน") → เสร็จแล้ว (บันทึกเวลาเสร็จอัตโนมัติ)
```

**ใครกดปุ่มเปลี่ยนสถานะได้:** เฉพาะคนที่ถูก assign ขั้นตอนนั้นเอง หรือ Supervisor ขึ้นไป
(Manager/Owner กดแทนได้เสมอ) — คนอื่นจะไม่เห็นปุ่มเลย เห็นแค่ข้อความว่ากำลังรอใครดำเนินการ
ระบบบังคับกฎนี้ทั้งที่หน้าจอและที่ฐานข้อมูล (ต่อให้เผลอเปิด dev tools ก็เปลี่ยนสถานะแทนคนอื่นไม่ได้)

**เวลาที่บันทึกอัตโนมัติ:** เริ่มงานครั้งแรก (`started_at`) และเสร็จงาน (`completed_at`) — ไม่ต้อง
กรอกเอง

---

## 10. Admin (สายสำนักงาน) — 7th role + ขออนุมัติงานเสี่ยง (Maker-Checker) — ✅ ใช้งานได้จริง (เพิ่มใหม่ 23 ก.ค. 2026)

**Admin คือใคร:** บทบาทที่ 7 ของระบบ — trust tier เดียวกับหัวหน้างาน (Supervisor) แต่คนละสาย
Supervisor = สายหน้างาน (ปฏิบัติการ), Admin = สายสำนักงาน (ข้อมูล/เอกสาร/รายงาน) เชิญได้ที่
`/admin/team` เหมือน role อื่น (ทั้งแบบสร้างตรง username+PIN และเชิญทางอีเมล)

**Admin ทำอะไรได้บ้าง (เท่า Supervisor ทุกอย่าง ยกเว้นจัดการ API key):**
- กรอก/แก้ไขข้อมูลอะไหล่เต็มสิทธิ์ (เพิ่ม/แก้/ย้ายโซน/ขาย) — ลบ (hard delete) ไม่ได้เหมือนกับ role อื่นที่ไม่ใช่ Owner/Manager
- จัดการข้อมูลลูกค้า (import/แก้ไข) — รวมถึงหน้า "นำเข้าข้อมูลลูกค้าเดิม" ที่ตอนนี้ Admin เข้าได้แล้ว
- จัดการเอกสาร/ใบเสร็จ/ใบกำกับภาษีของงานซ่อมและการขายอะไหล่
- ดู/สร้างรายงาน, Export CSV
- **จัดการเซตอะไหล่+ค่าแรงตามประเภทงาน** (ดูข้อ 11) — เท่า Owner/Manager
- 🔒 **ทำไม่ได้เด็ดขาด:** จัดการ API key (สงวนไว้ Owner/Manager เท่านั้น — floor rule ไม่เปลี่ยนตาม role)

**ขออนุมัติงานเสี่ยง (Maker-Checker):** บางงานที่ Admin ทำ ระบบตั้งไว้ให้ต้องรอผู้จัดการ/เจ้าของ
อนุมัติก่อนถึงจะมีผลจริง (ตอนนี้ enforce จริงแค่ 2 งาน — ที่เหลือแค่ตั้งค่าไว้ล่วงหน้ารอฟีเจอร์ต้นทาง
สร้างเสร็จ):
- **นำเข้าข้อมูลลูกค้า** — default ต้องขออนุมัติ (bulk operation กระทบข้อมูลจำนวนมาก)
- ที่เหลือ (ยกเลิกเอกสาร, ออกใบลดหนี้, ลบของซ้ำ ฯลฯ) — ตั้งค่าได้ล่วงหน้าที่หน้าตั้งค่า แต่ยังไม่ enforce
  จริงจนกว่าฟีเจอร์ที่เกี่ยวข้องจะสร้างเสร็จ

**หน้าที่เกี่ยวข้อง (เห็นเฉพาะร้านที่มี Admin จริงอย่างน้อย 1 คน — ร้านที่ไม่เคย invite Admin ไม่เห็นเมนู
นี้เลย ไม่มี overhead ใดๆ เพิ่ม):**
- `/admin/settings/admin-approvals` (Owner/Manager) — ตั้งว่างานไหนต้องขออนุมัติ + ใครอนุมัติ
- `/admin/admin-approvals` (Owner/Manager/Admin) — คิว "รออนุมัติ" กด ✅/❌ ได้เลย
- **Owner กดอนุมัติได้เสมอเป็น fallback สุดท้าย** ไม่ว่าจะตั้งผู้อนุมัติเป็นใครไว้ก็ตาม (กันร้านเล็กที่มี
  แค่ Owner+Admin ติดล็อกหาผู้อนุมัติไม่เจอ)

---

## 11. เซตอะไหล่+ค่าแรงตามประเภทงาน (Job Type Bundle Template) — ✅ ใช้งานได้จริง (เพิ่มใหม่ 23 ก.ค. 2026)

**ใช้ยังไง:** ในหน้ารายละเอียดงาน (`/jobs/[id]`) พิมพ์ชื่อประเภทงาน (เช่น "เปลี่ยนถ่ายน้ำมันเครื่อง")
ในช่อง "🧰 พิมพ์ชื่อประเภทงาน" — ถ้ามีเซตที่ตรงกัน ระบบดึงรายการอะไหล่+ค่าแรงทั้งหมดมาให้พร้อมราคา
ล่าสุด เลือก sub-variant ได้ถ้ามี (เช่น น้ำมันเกียร์ CVT vs WS) กด "✅ ใช้เซตนี้" ใส่เข้างานทีเดียว
ทั้งหมด แล้วลบรายการที่ไม่ต้องการออกทีหลังได้ตามปกติ

**ใครทำอะไรได้:**
- **ช่าง (Technician):** ค้นหา/เลือกจากเซตที่มีอยู่จริงเท่านั้น — พิมพ์แล้วไม่เจอ ไม่มีทางสร้างเซตใหม่
  เองได้ (กันชื่อประเภทงานเพี้ยน/ซ้ำซ้อน) ต้องแจ้ง Owner/Manager/Admin ให้สร้างเซตใหม่แทน
- **Owner/Manager/Admin:** พิมพ์ชื่อใหม่ที่ยังไม่มีเซตได้ — ระบบเปิดหน้าต่างยืนยันให้กรอกรายการ+ราคา
  ก่อน save เป็นเซตใหม่ แล้วใส่เข้างานปัจจุบันทันที ไม่ต้องออกไปหน้าตั้งค่าแยก (ดู/แก้/ลบเซตเก่าทีหลัง
  ได้ที่หน้า "🧰 เซตอะไหล่+ค่าแรงตามประเภทงาน" ใน `/admin`)

**ราคาจำ (price memory):** ค่าอะไหล่ — ระบบจำราคาล่าสุดที่ใช้จริงในงาน แล้วเสนอเป็นค่าเริ่มต้นให้เซต
ครั้งถัดไปอัตโนมัติ / ค่าแรง — ไม่จำราคาเด็ดขาด (ปรับได้บ่อย ต้องกรอกเองทุกครั้ง)

**เสนออะไหล่ซ้ำจาก sub-variant อื่นในเซตเดียวกัน (เพิ่มใหม่ 24 ก.ค. 2026):** ตอนสร้าง/แก้เซตใหม่
(`components/JobTypeBundleConfirmModal.js`) แล้วกด "+ เพิ่ม sub-variant" — ถ้ามีอะไหล่ที่ผูกกับ
สต็อกไว้แล้วในรายการอื่นของ**เซตเดียวกันนี้** (เช่น กรอก "น้ำมันเกียร์ CVT" ผูกกับสต็อกไปแล้ว
แล้วมาเพิ่มรายการ "น้ำมันเกียร์ WS" ต่อ) ระบบจะเสนอเป็นปุ่ม "ใช้อันเดียวกับที่เคยผูกไว้แล้ว" ให้กด
เลือกได้ทันที (ผลลัพธ์เหมือนค้นหาจากช่อง "🔍 ค้นหาจากสต็อก" ด้วยมือทุกประการ) แทนที่ต้องค้นหาจาก
สต็อกใหม่ทุกครั้ง — เป็น reuse-from-context ล้วนๆ (สแกนจาก state ของฟอร์มที่โหลดอยู่แล้ว ไม่ query
เพิ่ม ไม่มี fuzzy-match ชื่อ ไม่มี field ใหม่สำหรับจัดกลุ่ม) ถ้าเซตนี้ยังไม่มีอะไหล่ผูกไว้ที่ไหนเลย
(เช่น รายการแรกสุด) จะไม่เห็น suggestion อะไรเพิ่ม — ช่องค้นหาด้วยมือยังเป็น fallback อยู่เสมอ
(Notion: 3a6f39f4564981ed9addfd3ed14577b3)

---

## 12. Tier / Feature Gating (Starter/Founder/Pro) — 🔜 กำลังพัฒนา (ยังไม่ deploy จริง เพิ่มใหม่ 24 ก.ค. 2026)

**สถานะจริง ณ วันที่ตรวจ:** ระดับ subscription tier (`trial`/`starter`/`founder`/`pro`/`enterprise`)
มีอยู่แล้วและใช้งานจริงฝั่ง Platform Admin (ดูข้อ 8 — แท็บ "💰 Revenue" คำนวณ MRR/ARR แยกตาม tier
ได้ถูกต้อง) แต่**ตัวฟีเจอร์ gating ฝั่งแอปที่บังคับว่า tier ไหนเห็น/ใช้ฟีเจอร์อะไรได้บ้าง
(`lib/featureGating.js`) ยังเป็นโค้ดที่ค้างอยู่ในเครื่อง ยังไม่ได้ commit เข้า git เลย** — ห้ามอ้างอิงว่า
"ใช้งานได้จริงแล้ว" จนกว่าจะ commit + push + verify บน staging ก่อน

**แผนที่ออกแบบไว้ (จาก test coverage ที่เขียนไว้ล่วงหน้าแล้ว):**
- `admin_basic` (Starter ขึ้นไป): เข้าหน้า `/admin` ตั้งค่าระบบได้ — Trial เข้าไม่ได้
- `gallery_view` (Founder ขึ้นไป): ปุ่ม "🖼 Gallery" บนหน้าแรก
- `multi_photo` (Founder ขึ้นไป): ปุ่ม "เลือกจากคลังภาพ" บนหน้าเพิ่มอะไหล่ — Starter ต้องไม่เห็น
- `audit_log` (Founder ขึ้นไป): ปุ่ม "📜 ประวัติ" ใน `/admin/car-data`
- `reports_analytics` (Pro ขึ้นไป): เข้าหน้า `/admin/reports` (รายงานการขาย) ได้
- `multi_branch` / `api_access` (Enterprise): ยังไม่มีหน้าจริงรองรับเลย รอฟีเจอร์ต้นทาง

**สิ่งที่ต้องทำก่อนปิดงานนี้:** commit `lib/featureGating.js` + หน้า `/admin/*` ที่แก้ไปพร้อมกัน
เข้า git ที่ staging repo, รัน QA suite เต็มรอบยืนยัน TIER-1xx ถึง TIER-5xx ผ่านทั้งหมด แล้วค่อยพอร์ตเข้า
`main` ตามขั้นตอนปกติ (ดู README หัวข้อ deploy)

---

## 13. รายงานสรุปสต็อก (Stock Summary Report) — Pro+ — ✅ ใช้งานได้จริงแล้ว (เพิ่มใหม่ 24 ก.ค. 2026)

**การ์ด:** Notion `3a1f39f4564981d1a15ed167dcd8031b` — ต่อยอดจาก Stock Value Cap Engine (ข้อ 12
ไม่เกี่ยว — นี่คนละระบบ เป็น gate เฉพาะหน้ารายงานนี้เอง ไม่ใช่ `lib/featureGating.js` ที่ยังค้างอยู่)

**เข้าที่ไหน:** `/admin/stock-summary-report` (ลิงก์จากหน้า `/admin` — การ์ด "📦 รายงานสรุปสต็อก" —
แสดงเฉพาะ owner/manager ของร้าน Pro ขึ้นไปเท่านั้น) เนื้อหา 5 ส่วนตามการ์ด:

1. **มูลค่าสต็อกขึ้นงบจริง (on-balance):** ซื้อตรง (`price`) + ถอดจากซาก (`allocated_cost`) +
   ซากที่ยังถอดไม่หมด (`purchase_price` − Σ `allocated_cost` ที่จัดสรรไปแล้ว) เฉพาะของที่
   `effective_owner_type = 'own'` — **reuse สูตรเดียวกับ Stock Value Cap Engine เป๊ะ** (ดู
   `db/stock_summary_report_migration.sql` หัวไฟล์ — คัดลอก expression `coalesce(allocated_cost,
   price, 0) * quantity` มาจาก `fn_update_shop_stock_value()` ตรงๆ ไม่ derive ใหม่ — มี test
   ยืนยัน invariant นี้ใน `qa-automation/tests/stock-summary-report.spec.js` SSR-001)
2. **มูลค่าฝากขาย (off-balance, memo):** `effective_owner_type` = `consignment`/`investor` (จาก
   `zones.owner_type` + `parts.owner_type_override` — ค่าจริงที่ schema อนุญาต 3 ค่า ไม่ใช่แค่
   own/consignment ตามที่การ์ดเขียนไว้เฉยๆ) — ไม่รวมในข้อ 1 เด็ดขาด
3. **สถานะซากรถต่อคัน:** purchase_price, ยอดขายสะสม, ต้นทุนที่รับรู้แล้ว (เฉพาะชิ้นที่**ขายแล้ว**
   ไม่ใช่แค่ถอดแล้ว), กำไรสะสม
4. **ค้างสต็อกนาน:** เกณฑ์ **90 วัน (ชั่วคราว — ยังไม่เคาะเลขจริงจากคุณอั้ม)** อยู่ที่
   `config/reportingThresholds.js`
5. **Top 10 ขายดี/ขายช้า:** หน้าต่าง **30 วัน (ชั่วคราว)** เป็นค่าเริ่มต้น แต่ API รับ `?days=`
   override ได้เสมอ (เผื่อทำ "เลือกได้" ทีหลังไม่ต้องแก้ backend)

**Backend:** SQL functions ใน `db/stock_summary_report_migration.sql` (เรียกผ่าน
`app/api/reports/stock-summary/route.js` ด้วย `supabaseAdmin.rpc()`) — role gate (เดิม hardcode
owner/manager, **retrofit 24 ก.ค. 2026 ให้อ้าง `canSeeField(role, "sales_reports")` จาก
`config/fieldVisibility.js` แทน — ดูข้อ 14** — default ให้ผลเหมือนเดิมบวก supervisor/admin)
+ tier gate (Pro ขึ้นไป, เช็ค `subscription_plan` ผ่าน `getTierConfig()`) ทั้งที่ UI (ซ่อนลิงก์) และ
API (403) ตาม convention เดียวกับ `app/api/sales/export-csv/route.js`

**Real-time only:** เหมือน Stock Value Cap Engine เอง — **ยังไม่รองรับดูย้อนหลัง ณ สิ้นเดือนที่
ผ่านมา (snapshot)** ตั้งใจเลื่อนไว้ตามขอบเขตงาน ไม่ใช่ของหลุดมือ

**เลขชั่วคราว 2 ตัวที่ยังไม่เคาะจริง (ต้องกลับมาคุยกับคุณอั้ม):** เกณฑ์ค้างสต็อก 90 วัน และหน้าต่าง
Top 10 30 วัน — ดูคอมเมนต์เต็มใน `config/reportingThresholds.js`

---

## 14. Field Visibility Whitelist กลาง (role × field group) — ✅ ใช้งานได้จริงครบ 4 การ์ด (เพิ่มใหม่ 24 ก.ค. 2026)

**การ์ด:** Notion `3a1f39f4564981f1b544ca7ab0b00973` — เกิดจาก gap review ที่พบว่ากติกา "role ไหน
เห็นข้อมูลอ่อนไหวอะไร" โผล่ซ้ำแยกกันใน 4 การ์ด (Export CSV, Custom Report Builder, API พื้นฐาน,
Field Scanner Role) โดยไม่มีที่กำหนดกลาง

**Config กลาง:** `config/fieldVisibility.js` — export `DEFAULT_FIELD_VISIBILITY` (matrix role ×
field group, ตัดสินใจแล้วในการ์ด), `FLOOR_RULES` (คู่ role+field group ที่ปรับสูงกว่านี้ไม่ได้เด็ดขาด
ไม่ว่าเจ้าของร้านจะตั้งยังไง — Field Scanner เห็นชื่อ/เบอร์ลูกค้าไม่ได้, จัดการ API key สงวน
owner/manager เท่านั้น), และ `canSeeField(role, fieldGroup, overrides)` — เช็ค floor ก่อนเสมอ ตามด้วย
override ต่อร้าน (ถ้ามี) แล้วค่อย fallback ไป default matrix

**Override ต่อร้าน:** ตาราง `shop_field_visibility_overrides` (`db/field_visibility_overrides_migration.sql`
+ แก้เพิ่ม role `admin` ทีหลังใน `db/field_visibility_admin_role_fix_migration.sql`) — Owner ปรับได้
ที่หน้า `/admin/settings/field-visibility` (mirror pattern เดียวกับ
`/admin/settings/admin-approvals`) floor rule บังคับซ้ำที่ DB layer ด้วย trigger
`fn_enforce_field_visibility_floor` (defense in depth — ปฏิเสธแม้เขียนตรงเข้าตารางข้าม UI ทั้งหมด)

**Wire เข้าครบทั้ง 4 การ์ดที่ควรใช้ matrix นี้แล้ว (ก่อนหน้านี้มีแค่ Export CSV):**
1. **Export CSV** (parts/jobs/sales) — `app/api/{parts,jobs,sales}/export-csv/route.js`
2. **Field Scanner Role** — `app/api/jobs/route.js` + `app/api/jobs/[id]/route.js` ใหม่ mask
   `customer_name`/`customer_phone` ฝั่ง server (ก่อนหน้านี้ `/jobs`, `/jobs/[id]` query ตรงจาก
   client โดยไม่กรองคอลัมน์ตาม role เลย — floor rule ของการ์ดนี้ไม่เคย enforce จริงมาก่อน)
3. **Reports** — `/admin/reports` (ผ่าน `app/api/reports/sales/route.js` ใหม่) และ
   `/admin/stock-summary-report` (retrofit role gate เดิม) ทั้งคู่เช็ค
   `canSeeField(role, "sales_reports")` จาก matrix กลางแทน hardcode role list
4. **API พื้นฐาน (Pro+)** — ยังไม่มีโค้ดเลย (การ์ดของตัวเอง deferred แยกต่างหาก) — N/A ตอนนี้ config
   พร้อม plug-in ได้ทันทีที่ฟีเจอร์นี้เริ่มสร้างจริง

**Known gap ที่ตั้งใจไม่แก้ (นอกขอบเขตการ์ดนี้):** user ที่ login ด้วย role ของตัวเองยัง query
supabase-js ตรงๆ ข้าม Next.js API layer ได้ (ข้าม mask ที่ route ทำไว้) เพราะ RLS ของโปรเจกต์นี้ scope
แค่ `shop_id` ไม่เคย scope คอลัมน์ต่อ role แอปเลย — เหมือน limitation เดิมของ `view_price`
(`config/rolePermissions.js`) ที่ซ่อนแค่ฝั่ง client ที่ `app/page.js` ต้องแก้ผ่าน Postgres
view/RPC ที่เช็ค role จาก `auth.uid()` เองถึงจะปิดช่องนี้ได้จริงทุกจุด

**Test:** `qa-automation/tests/field-visibility-whitelist.spec.js` — assert ว่า field ต้องห้ามหายไป
จาก response body จริง (ไม่ใช่แค่ DOM) ครบทุก role × channel ที่ระบุในการ์ด + floor override ถูก
ปฏิเสธเสมอแม้ยิงตรงเข้า DB ข้าม UI

---

## 15. สาขา (Branches — Multi-branch support) — ✅ ใช้งานได้จริง (เพิ่มใหม่ 24 ก.ค. 2026)

**การ์ด:** Notion `3a1f39f45649810cb1fffbfa5da1d799` ("Multi-branch support, Pro=2 สาขา,
Enterprise=ไม่จำกัด")

**⚠️ อ่านก่อนแก้อะไรที่เกี่ยวกับ "สาขา"/"อู่ในเครือ" — 2 concept นี้เป็นคนละเรื่องกันโดยสิ้นเชิง:**
- **"สาขา" (Branches, การ์ดนี้)** = หลายที่ตั้งทางกายภาพของ **ร้าน/เจ้าของเดียวกัน** (`shop_id`
  เดียว, subscription เดียว, เลขผู้เสียภาษี 13 หลักเดียวกัน) ต่างกันแค่รหัสสาขากรมสรรพากร 5 หลัก
  ต่อท้าย (00000=สำนักงานใหญ่/สาขาหลัก, 00001, 00002, ...) — นี่คือความหมายจริงของ "สาขา" ตาม
  กฎหมายภาษีไทย
- **"อู่ในเครือ" / shop_groups** = ร้านคนละ`shop_id`/คนละเจ้าของ/**คนละเลขผู้เสียภาษี** ที่ไม่เป็น
  ทางการ (informal) แต่รวมกันเพื่อดูรายงานภาพรวม — ใช้โดย Accounting Module (การ์ด intercompany/
  consolidation scope) เท่านั้น **ยังไม่ได้ออกแบบ ยังไม่มีโค้ดใดๆ เลย** ณ วันที่เขียน section นี้
  (24 ก.ค. 2026) — การสร้างฟีเจอร์สาขาในการ์ดนี้ **ไม่ได้ปลดบล็อก** Accounting Module's
  intercompany scope แต่อย่างใด เป็นกลไกคนละอันที่ต้องออกแบบแยกต่างหาก
- หัวข้อ 8 ด้านบน ("การจัดการอู่ในเครือ / จัดการทีม") ใช้คำว่า "อู่ในเครือ" หลวมๆ ในชื่อหัวข้อ
  (หมายถึงแค่ "จัดการทีม/สมาชิกของร้านตัวเอง" ธรรมดา) **ไม่ใช่** shop_groups ที่พูดถึงข้างบน — เป็น
  ความบังเอิญของการใช้คำ ไม่ใช่ฟีเจอร์เดียวกัน ระวังสับสน

**สถาปัตยกรรม (Approach A ตามที่การ์ดตัดสินใจ):** `branches` เป็น child table ของ `shops` — 1
shop_id ครอบทุกสาขา, subscription เดียวกันหมด (`db/multi_branch_support_migration.sql`)

- **`branches`**: `branch_id`, `shop_id` (FK), `branch_code` (5 หลัก, unique ต่อ shop),
  `branch_name`, `is_default` (สาขาแรก/สาขาหลักของร้าน — ห้ามลบ/ปิด/ตั้ง read-only เด็ดขาด),
  `is_active` (ปิดสาขาถาวร), `is_read_only` (เกิดจาก downgrade — ดูข้อมูลได้ แก้ไข/ขาย/สร้างงาน
  ใหม่ไม่ได้)
- **Role ต่อสาขา:** `shop_members` เพิ่ม `branch_id` (NOT NULL) + unique constraint เปลี่ยนจาก
  `(shop_id, user_id)` เป็น **`(shop_id, user_id, branch_id)`** — คนเดียวกันเป็น Manager ที่สาขา 1
  และ Technician ที่สาขา 2 ได้พร้อมกัน (หลายแถวต่อ user ต่อ shop)
- **branch_id ถูกเพิ่มบน:** `parts`, `jobs`, `zones`, `visibility_groups`, `shop_invites` (nullable
  บนตารางที่มี legacy shop_id=NULL เดิม, NOT NULL บนที่เหลือ)
- **RLS ใหม่:** `is_branch_member(branch_id, roles)` (แทนที่ `is_shop_member` บนตารางที่ scope ตาม
  สาขา) — **owner/manager เห็น/ทำงานข้ามทุกสาขาของร้านตัวเองได้เสมอ** (judgment call ของงานนี้ ไม่ได้
  ระบุตรงๆ ในการ์ด แต่สอดคล้องกับ `can_view_job()` เดิมที่ owner/manager ข้าม visibility group อยู่
  แล้ว), role อื่นถูกจำกัดเฉพาะสาขาที่มีแถว `shop_members` อยู่จริง — `is_branch_writable(branch_id)`
  เช็คเพิ่มว่าสาขานั้น active+ไม่ read-only+shop ยัง active ก่อนอนุญาต insert/update
  - **⚠️ บทเรียนจากการ debug งานนี้จริง (24 ก.ค. 2026):** RLS permissive policies หลายอันบนตาราง
    เดียวกันถูก **OR รวมกัน ไม่ใช่ AND** — `parts` มีโพลิซี "estimated_value floor on
    insert/update" แยกจาก policy หลัก ซึ่งไม่เคยเช็ค `branch_id` เลย ทำให้ owner ยัง insert/update
    อะไหล่ในสาขา read-only ได้ผ่าน policy นี้ (เพราะเงื่อนไขของมันเองผ่านอิสระ) ทั้งที่ policy
    หลักบล็อกไปแล้ว — เจอจาก `qa-automation/tests/multi-branch-support.spec.js` TC-MB-5 แก้แล้วโดย
    เพิ่มเงื่อนไข branch-writable เข้าไปในทุก permissive policy ของตารางเดียวกัน **ถ้าเพิ่มตาราง/
    policy ใหม่ที่ scope ตามสาขาทีหลัง ต้องเช็คว่าไม่มี policy อื่นของตารางเดียวกันที่ลืมใส่เงื่อนไข
    เดียวกันไว้ ไม่งั้นจะรั่วแบบเดียวกันอีก**
- **Tier limit:** Starter/Founder/Trial = 1 สาขา (สร้างเพิ่มไม่ได้เลย), Pro = 2, Enterprise =
  ไม่จำกัด — enforce ทั้ง UI (`app/admin/branches/page.js` ซ่อนปุ่มสร้างเมื่อถึง limit), API
  (`app/api/branches` POST, `lib/teamAuth.js` `checkBranchLimit`) และ DB (trigger
  `trg_branches_tier_limit`) — ตัวเลขซ้ำอยู่ 2 ที่ (`config/subscriptionTiers.js` `maxBranches` +
  SQL `fn_tier_max_branches`) ตาม pattern เดียวกับ Stock Value Cap Engine เดิม
- **Downgrade Enterprise→Pro ขณะมีสาขาเกิน limit:** ยอมให้ downgrade เสมอ ไม่บล็อก — เจ้าของร้าน
  เลือกเองผ่าน `/admin/branches` ว่าจะตั้งสาขาไหนเป็น `is_read_only` (สาขา default ตั้ง read-only
  ไม่ได้เด็ดขาด — กันร้านใช้งานไม่ได้เลย)
- **Stock Value Cap Engine / concurrent-session limit ยังคงนับรวมทั้งร้าน** (ไม่ใช่แยกต่อสาขา) —
  `shops.current_stock_value`/`stock_cap_status`/`user_sessions` ไม่มีการเปลี่ยนแปลงจากงานนี้เลย
  เพราะเป็น subscription เดียวครอบทุกสาขาตามที่การ์ดตัดสินใจ
- **Data migration (สำคัญสุดตามการ์ด):** backfill สร้าง 1 สาขา default ต่อร้านเดิมทุกร้าน +
  ผูกทุกแถว (`shop_members`/`parts`/`jobs`/`zones`/`visibility_groups`) เข้าสาขานั้น — idempotent
  (verify แล้วว่า re-run ซ้ำไม่สร้างสาขาซ้ำ/ไม่พังอะไร) ตรวจสอบจริงกับ staging (qmqabtrrubqcmafietsr)
  แล้วว่า row count ตรงกันทุกตารางก่อน/หลัง
- **Branch Transfer (โอนอะไหล่ข้ามสาขา)** เป็นการ์ดแยกต่างหาก (Notion `3a2f39f4564981829c4dc50a2d92decf`)
  **ยังไม่ได้สร้างในงานนี้** — schema ของงานนี้ (`parts.branch_id`) ออกแบบให้รองรับการ์ดนั้นได้ตรงๆ
  (เพิ่ม `part_transfers`/`transfer_line_items` แยกต่างหากทีหลัง ไม่ต้องแก้ shape ของ `parts` เพิ่ม)
- **UI:** branch switcher ใน `components/AppShell.js` (mirror pattern เดียวกับ shop switcher เดิม
  — ซ่อนถ้าร้านมีสาขาเดียว), `app/admin/branches/page.js` (สร้างสาขา/toggle read-only, เฉพาะ
  owner/manager), assign role ต่อสาขาผ่าน `/admin/team` เดิม (extend ให้ส่ง `branch_id` ได้ ถ้าไม่ส่ง
  fallback ไปสาขา default ของร้านอัตโนมัติ — ร้านสาขาเดียวไม่ต้องแก้อะไรเลย)
- **Backward compatibility:** ร้านสาขาเดียว (ส่วนใหญ่ >99% ของร้านตอนนี้) ไม่เห็นการเปลี่ยนแปลงใดๆ
  เลย — helper ทุกตัว (`getCallerShopRole`, `verifyShopManager`, ฯลฯ) fallback ไปที่สาขาเดียวที่มี
  อัตโนมัติแบบโปร่งใส ไม่ต้องส่ง `branch_id` เพิ่มจากทุก call site เดิม

**Test:** `qa-automation/tests/multi-branch-support.spec.js` (TC-MB-1..6) — data migration
integrity, tier limits (API layer), branch-scoped isolation, per-branch role, downgrade
read-only, stock-cap whole-shop

**Known residual risk (ยังไม่ปิดสนิท):** cross-branch visibility rule (owner/manager เห็นข้าม
สาขา, role อื่นไม่เห็น) เป็น judgment call ของทีมงานนี้ ไม่ใช่มติที่การ์ดระบุไว้ตรงๆ ทุกกรณี —
ควรให้ product owner review ก่อนถือว่าปิดงานสนิท 100%

---

## 🔒 กระบวนการกัน Schema Drift (เพิ่มใหม่ 20 ก.ค. 2026)

**ปัญหาที่เจอจริงคืนนี้:** พบ 2 จุดที่ schema/ข้อมูลบน DB จริง (staging) นำหน้าไฟล์ใน git ไปมาก —
`model_trims` มี 1508 แถวบน DB จริงแต่ไฟล์ seed ใน repo สร้างได้ไม่ครบ, และ
`platform_admins.role` + `platform_audit_log` มีอยู่แล้วบน DB จริงแต่ไม่มีไฟล์ migration ใน git เลย
ถ้าต้องสร้าง environment ใหม่จากไฟล์ใน repo ล้วนๆ (เช่น กู้คืนหลังเหตุฉุกเฉิน) **ข้อมูล/schema
เหล่านี้จะหายไปทั้งหมด**

**กติกาใหม่ (บังคับใช้ตั้งแต่วันนี้):**

1. **แก้ DB ตรง (ผ่าน Supabase SQL Editor/MCP) เมื่อไหร่ ต้อง export กลับเข้า `db/` เป็นไฟล์
   `.sql` ในวันเดียวกัน** ห้ามปล่อยค้างข้ามวัน — ยิ่งค้างนาน ยิ่งเสี่ยงลืมว่าแก้อะไรไปบ้าง
2. **ไฟล์ seed ข้อมูลอ้างอิงถึงแถวอื่น (เช่น `model_trims` อ้าง `generation_id`) ต้อง lookup
   ด้วยชื่อ/โค้ดที่อ่านได้ (brand_name + model_name + generation_code) ห้ามใช้ id ตัวเลขดิบ** —
   id ไม่ตรงกันระหว่าง beta/staging/prod เป็นเรื่องปกติ (ยืนยันแล้วจากของจริงคืนนี้ — Toyota Camry
   ที่ staging คือ generation_id 315 แต่จะไม่ตรงกับ prod แน่นอน) ทำให้ไฟล์ที่อ้าง id ตรงๆ พังทันที
   ที่ environment ไม่ตรงกัน (และพังแบบ atomic — เสียข้อมูลทั้งไฟล์ ไม่ใช่แค่บางแถว ถ้าเขียนเป็น
   `INSERT ... VALUES (...), (...), ...` ก้อนเดียว)
3. **ก่อนปิดงานที่แตะ schema ใดๆ ให้รัน fresh-install test อย่างน้อย 1 ครั้ง** — ลง Postgres
   เปล่าในเครื่อง (`postgresql-16` มีอยู่แล้วใน dev sandbox) รันไฟล์ `db/*.sql` ตามลำดับ แล้วเทียบ
   จำนวนแถว/schema กับ DB จริง ว่าตรงกันไหม ถ้าไม่ตรง = มี drift ที่ยังไม่รู้ตัว
4. **Migration ใหม่ทุกไฟล์ต้อง idempotent** (`create table if not exists`, `alter table add
   column if not exists`, `on conflict do nothing`, เช็ค `pg_constraint` ก่อน `add constraint`)
   — ต้องรันซ้ำได้โดยไม่พังไม่ว่า environment จะอยู่ในสถานะไหนมาก่อน

**เกิดซ้ำอีกคืนนี้ (21 ก.ค. 2026)** — ยืนยันว่ากติกาด้านบนยังจำเป็นอยู่จริง: พบ 3 จุดเพิ่มเติมที่
DB จริงนำหน้าไฟล์ใน git (`job_workflow_steps.hold_reason/held_at` + trigger บังคับลำดับสถานะ,
`audit_log.record_uuid/shop_id` + RLS policy ที่ scope ตาม shop ถูกต้องอยู่แล้ว, trigger
`trg_audit_parts`) — export กลับเป็น `db/job_assignment_status_tracking_migration.sql` และ
`db/audit_log_parts_coverage_migration.sql` แล้วทั้งคู่ ตามกติกาข้อ 1

**เกิดซ้ำอีกรอบ (nightly run #3, ดึกคืนเดียวกัน 21 ก.ค. 2026):** พบจุดใหญ่ที่สุดเท่าที่เจอมา —
ทั้งโครงสร้าง Area/Rack/Level (`zones.parent_id`, `zones.path` เป็น ltree จริง, ltree extension,
trigger รักษา path + กันวงจร, unique code ต่อ parent) และ `parts.zone_id` **ไม่เคยมีไฟล์ migration
เลยแม้แต่ไฟล์เดียว** ทั้งที่ใช้งานจริงอยู่ในแอปมาหลายคืนแล้ว (UI cascading select/filter/breadcrumb
ทำงานอ้างอิงคอลัมน์เหล่านี้ตรงๆ) — export กลับเป็น `db/zone_hierarchy_ltree_migration.sql` แล้ว
ระหว่างตรวจพบด้วยว่ามีช่องโหว่ multi-tenant จริง (RLS เช็คแค่ shop_id ไม่เคยเช็คว่า parent_id เป็น
zone ของร้านเดียวกัน) แก้เพิ่มเป็น trigger ใหม่ในไฟล์เดียวกัน

---

## 🔒 Middleware — Defense-in-depth route protection (เพิ่มใหม่ 24 ก.ค. 2026)

**ที่มา:** OWASP ASVS Level 1 self-assessment (Notion page `3a7f39f4564981db8a6fdd71aec69c61`,
24 ก.ค. 2026) + residual risk ที่ commit `812b8b8` ("verifyCaller now checks user_sessions
liveness") ระบุไว้ตรงๆ ในคอมมิทตัวเอง: การ์ดนั้นปิด gap แค่ฝั่ง Next.js API route (`app/api/**`)
เท่านั้น ไม่แตะ page-routing layer เลย

**ปัญหาเดิม:** แอปนี้ไม่เคยมี Next.js middleware เลยตั้งแต่เริ่มโปรเจกต์ — การป้องกันเส้นทางทั้งหมด
อยู่ที่ `components/RequireAuth.js` (client component) ชั้นเดียว แปลว่า request ที่ไม่มี session เลย
(หรือ session หมดอายุ) ยังได้รับ page shell + JS bundle เต็มๆ ก่อน ให้ React hydrate แล้ว
`RequireAuth.js` ค่อยเช็คแล้ว redirect ทีหลัง (ช่องโหว่จริงแต่ modest — ไม่มีข้อมูลหลุด แค่ page
shell/bundle เปล่าๆ)

**สิ่งที่เพิ่ม (`middleware.js`, root ของ repo):**
- ใช้ pattern ทางการของ Supabase (`@supabase/ssr`'s `createServerClient`) — อ่าน/เขียน auth cookie
  ผ่าน middleware request/response cookie API, เรียก `supabase.auth.getUser()` (ยืนยัน JWT จริง +
  refresh คืน cookie อัตโนมัติถ้าใกล้หมดอายุ) แล้ว redirect ไป `/login` (307) ถ้าไม่มี session ที่
  ยังไม่หมดอายุ สำหรับทุกเส้นทางที่ไม่ใช่ public path
- **Public paths** (ไม่ต้องมี session): `/login`, `/staff-login`, `/signup`, `/reset-password`,
  และ `/share/customer/[token]/**` (token-based, ไม่ใช่ Supabase Auth session — ดู
  `app/share/customer/[token]/page.js` + `app/api/public/customer/[token]/route.js`)
- **`/api/**` ไม่ถูกแตะเลย** (ยกเว้นทั้งหมดจาก matcher) — API routes มีชั้น auth ของตัวเองอยู่แล้ว
  (`verifyCaller()` ใน `lib/teamAuth.js` ผ่าน `Authorization: Bearer` header ไม่ใช่ cookie-based
  session) เอา middleware cookie-check ไปครอบซ้ำจะพัง `/api/public/customer/[token]` (ต้องเปิดให้
  ลูกค้าที่ไม่มี session เรียกได้) โดยไม่ได้อะไรเพิ่ม
- **⚠️ ต้องคู่กับการเปลี่ยน `lib/supabaseClient.js`** จาก `createClient` (`@supabase/supabase-js`
  เดิม, เก็บ session ใน **localStorage**) เป็น `createBrowserClient` (`@supabase/ssr`, เก็บ session
  ใน **cookie** แทน) — middleware รันฝั่ง edge อ่านได้แค่ cookie เท่านั้น ถ้าไม่เปลี่ยนตัวนี้คู่กัน
  ทุกคนที่ login อยู่จริงจะถูกเด้งไป `/login` ทันทีที่ deploy (นี่คือความเสี่ยงตัวสูงสุดของงานนี้ —
  ตรวจพบและแก้ก่อน push จริง ไม่ใช่หลัง)

**ไม่ครอบคลุม (ตั้งใจ ไม่ใช่ของหลุดมือ):**
- ไม่ปิด ASVS top gap #1 ("ไม่มี server-side session revocation สำหรับ direct-to-Supabase
  traffic") — middleware ทำงานแค่ตอน navigate หน้า Next.js เท่านั้น ไม่ได้แทรกอยู่ระหว่าง browser
  กับ Supabase REST ที่ยิงตรงหลังหน้าโหลดเสร็จแล้ว (เช่น เครื่องที่ถูก evict จาก concurrent-session
  cap — JWT เดิมยังผ่านเช็คนี้ได้จนกว่าจะหมดอายุเอง) เป็นคนละ gap คนละ layer กัน ยังต้องแก้แยก
- ไม่ทำ role/tier/branch authorization ละเอียด — ยังคงอยู่ที่ `RequireAuth.js` (`allowedRoles`),
  API routes, และ RLS policies เหมือนเดิมทุกประการ **`RequireAuth.js` ไม่ถูกแก้/อ่อนลงเลย** —
  middleware เป็นชั้นเสริมก่อนหน้าเท่านั้น (additive defense-in-depth)

**Test:** `qa-automation/tests/middleware-route-protection.spec.js` (ใหม่, 17 tests) — protected
paths (`/`, `/jobs`, `/admin`, `/add`) ไม่มี session ต้องได้ raw 307 redirect ตรงจาก server (พิสูจน์
ผ่าน `page.request` + `maxRedirects:0` ว่าเป็น middleware ทำ ไม่ใช่แค่ client fallback), public
paths + share-link portal ยังเข้าได้ปกติ, และ owner login แล้ว navigate ปกติไม่ถูกบล็อก — ผ่านหมด
บน staging จริง

**Regression sweep (broad, บนโค้ด/deployment เดียวกัน):** `rbac.spec.js`, `api-rbac.spec.js`,
`job-creation-rbac.spec.js`, `session.spec.js`, `card-tos-consent.spec.js`,
`card-payment-method.spec.js`, `job-creation-basic.spec.js`, `job-creation-multitenancy.spec.js` —
ผ่านหมดทุกไฟล์ (พบ+แก้ regression เล็กน้อยระหว่างทาง: `qa-automation/fixtures/api-helpers.js`
`getAccessToken()` เดิมอ่าน session จาก localStorage ตรงๆ พังเพราะ session ย้ายไปอยู่ cookie แล้ว
— แก้ให้อ่านจาก cookie แทน ดู commit `6f25464`)

**Known, ไม่เกี่ยวข้องกัน (ยืนยันแล้ว):** `job-type-bundle-rbac.spec.js` มี 3 tests fail ด้วย
Postgres error `42P10` (ON CONFLICT ไม่ match unique constraint) — เป็นปัญหา schema ของงาน
Multi-branch support ที่ทำคู่ขนานกันอยู่ (ไม่เกี่ยวกับ auth/session/middleware เลย) ยืนยัน
independence โดยรัน test เดิมกับ deployment **ก่อน** middleware commit (`e652074`, URL เฉพาะของ
deployment นั้น) — fail เหมือนกันทุกประการ (error เดียวกัน) พิสูจน์ว่า middleware ไม่ได้เพิ่ม/
เปลี่ยน failure mode นี้เลย

---

## 🔒 Supabase Security Advisor batch — RLS + RPC authorization hardening (เพิ่มใหม่ 24 ก.ค. 2026)

**ที่มา:** Notion card `3a7f39f45649817c85a3c1e2feca40dc` ("🔴 P0: Supabase Security Advisor
batch") — รัน `get_advisors(type=security)` บน staging เจอ 123 findings ส่วนใหญ่เป็น hygiene
noise แต่มี **2 ช่องโหว่จริงที่ยืนยันได้ว่า exploit ได้จริงด้วย live PoC** (ไม่ใช่แค่เชื่อ advisor
message เฉยๆ)

**ช่องโหว่จริง #1 — `parts.estimated_value` floor เป็น PERMISSIVE แทนที่จะเป็น RESTRICTIVE:**
policy "estimated_value floor on insert/update" ตั้งใจให้เป็น "ข้อจำกัดเสริม" (เฉพาะ
owner/manager/supervisor/admin เท่านั้นที่ตั้งค่านี้ได้) แต่สร้างเป็น PERMISSIVE (ค่า default) —
Postgres รวม PERMISSIVE policies ด้วย OR ไม่ใช่ AND ผลคือ floor ไม่บังคับใช้เลย **ยืนยันด้วย live
PoC:** technician (role ต่ำกว่าที่ควร) ตั้ง `estimated_value` ในอะไหล่ของอู่ตัวเองผ่านได้ตรงๆ —
แก้โดยเปลี่ยนทั้ง 2 policy เป็น `as restrictive`

**ช่องโหว่จริง #2 — Accounting module RPC 5 ตัวไม่เช็คสิทธิ์เลย:**
`fn_insert_system_journal_entry`, `fn_get_or_open_period`, `fn_backfill_current_period_sales`,
`fn_recalc_stock_cap_status`, `fn_seed_default_chart_of_accounts` เป็น `SECURITY DEFINER` และรับ
`p_shop_id` จากผู้เรียกตรงๆ โดยไม่เช็ค `is_shop_member()` เลย **ยืนยันด้วย live PoC:** technician
ของร้าน A ยิง RPC ใส่ `p_shop_id` ของร้าน B สำเร็จ — ทั้งฉีด journal entry ปลอมมูลค่า 9,999,999 บาท
เข้าบัญชีร้านอื่น และเปิดงวดบัญชีใหม่ให้ร้านอื่นได้ตรงๆ

**⚠️ บทเรียนสำคัญระหว่างแก้ (สำหรับใครแก้ RPC/RLS ต่อในอนาคต):** เติม `is_shop_member()` check
แบบเดียวกันทุกฟังก์ชันไม่ได้เสมอไป — `fn_insert_system_journal_entry`/`fn_get_or_open_period`/
`fn_recalc_stock_cap_status` ถูกเรียกจาก **trigger chain ที่ทำงานได้ทั้งจาก end-user จริงและจาก
service-role** (เช่น QA fixture, CSV import, admin backend script ที่ insert `part_sales`/`parts`
ตรงๆ ผ่าน service role) ซึ่ง `auth.uid()` จะเป็น `null` ในบริบท service-role — เช็คแบบ blanket
`if not is_shop_member(...)` จะพังทุก trigger-driven write ที่มาจาก service role ทันที (เจอจริง
ตอนรัน regression: `accounting-module-core.spec.js` ACC-004 ล้มเหลว) แก้ด้วย
`if auth.uid() is not null and not is_shop_member(...)` แทน (ยอมรับ null = ไม่เช็ค) **แต่ต้องคู่กับ
revoke EXECUTE จาก `anon` ด้วยเสมอ** ไม่งั้นผู้ใช้ที่ไม่ login เลย (anon key เปล่าๆ ก็ `auth.uid()`
เป็น null เหมือนกัน) จะเดินผ่าน check นี้ได้ฟรีๆ — ปิดช่องนั้นด้วย grant-level revoke แทน

**Revoke EXECUTE convention:** `revoke ... from anon, authenticated` เฉยๆ **ไม่พอ** ถ้าฟังก์ชันนั้น
grant ให้ PUBLIC มาตั้งแต่สร้าง (ค่า default ของ Postgres) — ต้อง `revoke ... from PUBLIC, anon,
authenticated` เสมอ (ดู `db/car_data_rpc_revoke_public_access_migration.sql` ที่วางแบบแผนนี้ไว้
ก่อนแล้ว) เจอปัญหานี้ตอนแก้ P1-1 (revoke ฟังก์ชัน trigger-only 8 ตัว) — revoke แบบเดิมไม่มีผลอะไร
เลยจนกว่าจะเพิ่ม PUBLIC เข้าไปด้วย ยืนยันผลจริงด้วย `has_function_privilege()` เสมอ อย่าเชื่อแค่ว่า
statement รันผ่านไม่ error

**Migration:** `db/security_advisor_batch_fixes_migration.sql` (idempotent, มีเหตุผลของแต่ละ
role-set ต่อฟังก์ชันอธิบายไว้ในไฟล์)
**Test:** `qa-automation/tests/security-advisor-batch-fixes.spec.js` (ใหม่ 14 tests — cross-shop
attack ทั้ง 2 เส้นทางถูกบล็อกจริง + positive control ของ role ที่ควรผ่านยังผ่านปกติ) + regression
สวีป `accounting-module-core.spec.js` (12), `db-rls.spec.js` (9), `multi-branch-support.spec.js`
(11, 1 fail ไม่เกี่ยวข้อง — ดูล่าง), `stock-summary-report.spec.js` (11) — ผ่านหมด

**ไม่ครอบคลุมรอบนี้ (ตั้งใจ, priority ต่ำสุดของการ์ด):** ย้าย `ltree` extension ออกจาก `public`
schema — ตรวจแล้วพบว่า extension นี้ติดตั้งทั้ง operator/function library (60+ objects) ไว้ใน
`public` ไม่ใช่แค่ type เฉยๆ ย้ายจริงต้องคู่กับการปรับ `search_path` ของ `zones_set_path`/
`zones_update_path` เป็น `public, extensions` ในการ์ดเดียวกัน — เสี่ยงพังฟีเจอร์ zone hierarchy
ถ้าไม่มี test window แยกต่างหาก แนะนำเปิดการ์ดใหม่ทำเรื่องนี้โดยเฉพาะ + เปิด "Leaked password
protection" ใน Supabase Dashboard > Authentication > Policies ต้องให้เจ้าของ product ทำเอง
(ไม่มี dashboard UI access จาก environment นี้)

**Known, ไม่เกี่ยวข้องกัน (ยืนยันแล้ว):** `multi-branch-support.spec.js` TC-MB-3a ล้มเหลวด้วย
`AuthApiError: invalid JWT ... unrecognized JWT kid` ตอนเรียก `auth.admin.createUser()` — ปัญหา
JWT signing key ของ environment เอง (เห็น warning เดียวกันใน global-setup ทุกรัน ทั้งก่อนและ
ระหว่างการแก้ครั้งนี้) ไม่เกี่ยวกับ RLS/RPC ที่แก้เลย

---

## อ้างอิงอื่นที่เกี่ยวข้อง

- รายละเอียดฟีเจอร์ระดับเทคนิค (schema, migration order, setup): `README.md`
- คู่มือผู้ใช้แบบละเอียด (role ไหนทำอะไรได้, หน้าจอเป็นยังไง): `USER_MANUAL.md` (แก้ไข 21 ก.ค. 2026
  — มีไฟล์อยู่ในโปรเจกต์แล้วจริง ไม่ใช่แค่การ์ด Notion draft ตามที่เอกสารนี้เคยระบุผิด)
- ภาพรวมสำหรับนำเสนอ/นักลงทุน พร้อม screenshot ฟีเจอร์หลัก: `PITCH_DECK.md` (เพิ่มใหม่ 24 ก.ค. 2026)
