import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "⚠️ ยังไม่ได้ตั้งค่า NEXT_PUBLIC_SUPABASE_URL หรือ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ใน .env.local"
  );
}

// การ์ด "middleware.js — defense-in-depth route protection (ASVS gap)" — เปลี่ยนจาก
// createClient (@supabase/supabase-js ธรรมดา, เก็บ session ใน localStorage) มาเป็น
// createBrowserClient (@supabase/ssr) ซึ่งเก็บ session ไว้ใน **cookie** แทน
//
// ⚠️ จำเป็นต้องเปลี่ยนตัวนี้คู่กับการเพิ่ม middleware.js — ถ้าไม่เปลี่ยน ตัว middleware (ที่รันฝั่ง
// server/edge และอ่าน session ได้จาก cookie เท่านั้น ไม่มีสิทธิ์เข้าถึง localStorage ของ browser)
// จะไม่มีทางเห็น session เลย ต่อให้ผู้ใช้ login อยู่จริงในเบราว์เซอร์ก็ตาม — จะกลายเป็นเด้งทุกคนไป
// /login ทันทีที่ deploy (แม้แต่คนที่ login ถูกต้อง) นี่คือ "official Supabase SSR pattern" ตามที่
// เอกสาร Supabase แนะนำสำหรับ Next.js App Router + middleware โดยเฉพาะ
//
// API หน้าตาเดิมทุกอย่าง (supabase.auth.*, supabase.from(), supabase.rpc() ฯลฯ) — โค้ดเดิมที่
// import { supabase } from "./supabaseClient" ทั่วแอป (AuthProvider.js, RequireAuth.js, ทุกหน้า)
// ไม่ต้องแก้อะไรเพิ่ม เป็นการเปลี่ยนแค่ที่มา/ที่เก็บของ session เบื้องหลังเท่านั้น
export const supabase = createBrowserClient(supabaseUrl, supabaseKey);
