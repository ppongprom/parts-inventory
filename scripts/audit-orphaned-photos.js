/**
 * ตรวจสอบไฟล์ใน Supabase Storage bucket "part-photos" ที่ไม่มี record ไหนใน
 * ตาราง parts อ้างอิงถึงแล้ว (orphaned files) — เกิดจาก record ถูกลบถาวรไปแล้ว
 * แต่ไฟล์รูปยังค้างอยู่ใน storage (ไม่ถูกลบตามไปด้วย)
 *
 * ใช้งาน:
 *   node scripts/audit-orphaned-photos.js              -> แค่แสดงรายการ (dry-run)
 *   node scripts/audit-orphaned-photos.js --delete     -> ลบไฟล์ orphan ออกจริง
 *
 * ต้องมี .env.local ที่มีค่า:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (ต้องใช้ตัวนี้ ไม่ใช่ publishable key เพราะต้องข้าม RLS
 *                                 เพื่อเห็นข้อมูลทุกอู่ ไม่ใช่แค่อู่เดียว)
 */

const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");

// โหลดค่าจาก .env.local เอง (ไม่พึ่ง Next.js runtime เพราะ script นี้รันนอก Next.js)
function loadEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("❌ ไม่พบไฟล์ .env.local ที่ project root");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvLocal();

const BUCKET = "part-photos";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "❌ ต้องมี NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local"
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const shouldDelete = process.argv.includes("--delete");

async function listAllStorageFiles() {
  const allFiles = [];
  let offset = 0;
  const pageSize = 100;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list("", {
      limit: pageSize,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;
    if (!data || data.length === 0) break;

    allFiles.push(...data.filter((f) => f.id !== null)); // กันโฟลเดอร์หลอกที่ list คืนมา
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allFiles;
}

async function getAllReferencedPaths() {
  const referenced = new Set();
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("parts")
      .select("photo_url, photo_urls")
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    for (const row of data) {
      const urls = [];
      if (row.photo_url) urls.push(row.photo_url);
      if (Array.isArray(row.photo_urls)) urls.push(...row.photo_urls);

      for (const url of urls) {
        const marker = `/${BUCKET}/`;
        const idx = url.indexOf(marker);
        if (idx !== -1) {
          referenced.add(url.slice(idx + marker.length));
        }
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return referenced;
}

async function main() {
  console.log(`🔍 ตรวจสอบไฟล์ orphan ใน bucket "${BUCKET}"...`);
  console.log(shouldDelete ? "⚠️  โหมดลบจริง (--delete)\n" : "ℹ️  โหมด dry-run (แค่แสดงรายการ ไม่ลบ)\n");

  const [storageFiles, referencedPaths] = await Promise.all([
    listAllStorageFiles(),
    getAllReferencedPaths(),
  ]);

  console.log(`ไฟล์ทั้งหมดใน storage: ${storageFiles.length}`);
  console.log(`path ที่ถูกอ้างอิงจากตาราง parts: ${referencedPaths.size}\n`);

  const orphaned = storageFiles.filter((f) => !referencedPaths.has(f.name));

  if (orphaned.length === 0) {
    console.log("✅ ไม่พบไฟล์ orphan เลย — storage สะอาดดี");
    return;
  }

  let totalBytes = 0;
  console.log(`⚠️  พบไฟล์ orphan ${orphaned.length} ไฟล์:\n`);
  for (const f of orphaned) {
    const sizeKb = f.metadata?.size ? (f.metadata.size / 1024).toFixed(1) : "?";
    totalBytes += f.metadata?.size || 0;
    console.log(`  - ${f.name}  (${sizeKb} KB, สร้างเมื่อ ${f.created_at})`);
  }
  console.log(`\nรวมพื้นที่ที่ไฟล์ orphan ใช้: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  if (shouldDelete) {
    console.log("\n🗑️  กำลังลบไฟล์ orphan ทั้งหมด...");
    const names = orphaned.map((f) => f.name);
    const { error } = await supabase.storage.from(BUCKET).remove(names);
    if (error) {
      console.error("❌ ลบไม่สำเร็จ:", error.message);
      process.exit(1);
    }
    console.log(`✅ ลบสำเร็จ ${names.length} ไฟล์`);
  } else {
    console.log(
      `\nรันคำสั่งนี้อีกครั้งพร้อม --delete เพื่อลบไฟล์เหล่านี้ออกจริง:\n  node scripts/audit-orphaned-photos.js --delete`
    );
  }
}

main().catch((err) => {
  console.error("❌ เกิดข้อผิดพลาด:", err.message);
  process.exit(1);
});
