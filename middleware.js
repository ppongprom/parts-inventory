import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// การ์ด "middleware.js — defense-in-depth route protection (เพิ่มใหม่ 24 ก.ค. 2026)"
//
// ที่มา: OWASP ASVS Level 1 self-assessment (Notion page 3a7f39f4564981db8a6fdd71aec69c61,
// 24 ก.ค. 2026) + residual risk ที่ commit 812b8b8 ("verifyCaller now checks user_sessions
// liveness") ระบุไว้ตรงๆ ในคอมมิทตัวเอง: การ์ดนั้นปิด gap แค่ฝั่ง Next.js API route
// (app/api/**) เท่านั้น ไม่แตะ page-routing layer เลย
//
// ก่อนหน้านี้แอปนี้ไม่มี Next.js middleware เลย — การป้องกันเส้นทางทั้งหมดอยู่ที่
// components/RequireAuth.js (client component) ชั้นเดียว แปลว่า request ที่ไม่มี session เลย
// (หรือ session หมดอายุ) ยังได้รับ page shell + JS bundle เต็มๆ ก่อน ให้ React hydrate และ
// RequireAuth.js ค่อยเช็คแล้ว redirect ทีหลัง (เห็นได้เสี้ยววินาที ก่อน client-side navigation)
//
// ตัวนี้คือชั้นป้องกัน "เพิ่มเติม" (additive defense-in-depth) ก่อนถึง RequireAuth.js เท่านั้น —
// ไม่ได้แทนที่ RequireAuth.js (ยังคงทำหน้าที่ allowedRoles / disabled-account / expired-account /
// signup-redirect ตามเดิมทุกประการ) เช็คแค่หยาบๆ ระดับ "มี Supabase session ที่ยังไม่หมดอายุอยู่
// ไหม" (fast cookie/JWT check) ไม่ทำ role/tier/branch authorization ละเอียดซ้ำกับที่
// RequireAuth.js / API routes / RLS policies ทำอยู่แล้ว — ถ้าไม่มี session เลย redirect ไป
// /login ทันทีที่ edge ไม่ต้องรอ JS bundle โหลด/hydrate ก่อน
//
// ⚠️ ไม่ครอบคลุม (ตั้งใจ ไม่ใช่ของหลุดมือ):
// - ไม่ปิด gap "browser ยิงตรงไปที่ Supabase REST ผ่าน RLS โดยตรง ข้าม Next.js" (ASVS top gap #1
//   ในเอกสารอ้างอิงข้างบน) เพราะ middleware ทำงานแค่ตอน navigate หน้า Next.js เท่านั้น ไม่ได้แทรก
//   อยู่ระหว่าง browser กับ Supabase REST ที่ยิงตรงหลังหน้าโหลดเสร็จแล้ว (เช่น เครื่องที่ถูก evict
//   จาก concurrent-session cap — JWT เดิมยังผ่านเช็คนี้ได้จนกว่าจะหมดอายุเอง เหมือนที่ commit
//   812b8b8 เคยระบุ residual risk ไว้ตรงๆ) — เป็นคนละ gap คนละ layer กัน ยังต้องแก้แยกต่างหาก
// - ไม่แตะ /api/** เลย (ดู matcher ด้านล่าง) เพราะ API routes มีชั้นตรวจของตัวเองอยู่แล้ว
//   (verifyCaller() ใน lib/teamAuth.js ยืนยันผ่าน Authorization: Bearer header ไม่ใช่ cookie-based
//   session) เอา middleware cookie-check ไปครอบ /api/** ซ้ำจะพัง app/api/public/customer/[token]/**
//   (ต้องเปิดให้ลูกค้าที่ไม่มี session เรียกได้ — ดู app/share/customer/[token]/page.js ที่ fetch
//   endpoint นี้ตรงๆ) และซ้ำซ้อนกับ endpoint อื่นที่ auth ผ่าน Bearer token อยู่แล้วโดยไม่ได้อะไรเพิ่ม
//
// ⚠️ ต้องคู่กับการเปลี่ยน lib/supabaseClient.js ให้ใช้ createBrowserClient (@supabase/ssr) แทน
// createClient (@supabase/supabase-js เดิม, เก็บ session ใน localStorage) — middleware รันฝั่ง
// edge อ่านได้แค่ cookie เท่านั้น ถ้า browser ยังเก็บ session ใน localStorage เหมือนเดิม middleware
// จะไม่เห็น session เลย ต่อให้ user login อยู่จริงก็ตาม (จะกลายเป็นเด้งทุกคนไป /login ทันที)

const PUBLIC_EXACT_PATHS = new Set(["/login", "/staff-login", "/signup", "/reset-password"]);

// เส้นทางลูกค้าดูสถานะงานผ่าน token ในลิงก์ (ไม่ใช่ Supabase Auth session) — ดู
// app/share/customer/[token]/page.js และ app/share/customer/[token]/job/[jobId]/page.js
// ต้องเปิดให้เข้าถึงได้แบบไม่ต้อง login เด็ดขาด ห้าม gate เส้นทางที่ขึ้นต้นด้วย prefix นี้
const PUBLIC_PREFIXES = ["/share/customer/"];

function isPublicPath(pathname) {
  if (PUBLIC_EXACT_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // ไม่มี env var ครบ (ไม่ควรเกิดจริงบน Vercel ที่ตั้งค่าไว้แล้ว) — ปล่อยผ่านแทนที่จะพังทั้งแอป
  // ให้ RequireAuth.js (client-side) ยังทำหน้าที่ป้องกันหลักต่อไปเหมือนเดิมก่อนมี middleware
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // ⚠️ ต้องใช้ getUser() ไม่ใช่ getSession() — getUser() ยืนยัน JWT กับ Supabase Auth server จริง
  // (และ refresh token คืน cookie ให้อัตโนมัติผ่าน setAll ด้านบนถ้า access token ใกล้/หมดอายุ)
  // getSession() อ่านจาก cookie เฉยๆ ไม่ยืนยันความถูกต้องอะไรเลย (คำเตือนตรงจาก Supabase SSR docs)
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  // ยกเว้น: /api/** ทั้งหมด (มีชั้น auth ของตัวเองแล้ว ดูคอมเมนต์ด้านบน), Next.js internals
  // (_next/static, _next/image), favicon, และไฟล์ static ทั่วไป (รูป/ฟอนต์/JS/CSS) — กันไม่ให้ยิง
  // supabase.auth.getUser() (network round-trip ไป Supabase Auth) ทุก request ของ static asset
  // โดยไม่จำเป็น (performance)
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2|ttf)$).*)",
  ],
};
