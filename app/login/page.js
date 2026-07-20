"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthProvider";

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, loading, sessionError } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  // ลืมรหัสผ่าน — แทนที่การพึ่ง scripts/reset-owner-password.mjs รันมือถาวร
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [forgotMsg, setForgotMsg] = useState(null);

  useEffect(() => {
    if (searchParams.get("reason") === "idle") {
      setMsg({ type: "error", text: "ระบบออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน" });
    }
  }, [searchParams]);

  // แก้บั๊ก "silent session kick": sessionError ถูก set ไว้ใน AuthProvider ตอน login
  // สำเร็จแต่ลงทะเบียน session ไม่ผ่าน (เช่น ชนกับ concurrent session limit ของ tier)
  // แต่เดิมไม่เคยถูกเอามาแสดงเลย ผู้ใช้โดนเด้งกลับมาหน้านี้เฉยๆ โดยไม่รู้สาเหตุ
  useEffect(() => {
    if (sessionError) {
      setMsg({ type: "error", text: sessionError });
    }
  }, [sessionError]);

  useEffect(() => {
    if (!loading && session) {
      router.replace("/");
    }
  }, [loading, session, router]);

  // แปล error ของ Supabase auth เป็นไทยล้วน — ห้ามต่อ error.message (ภาษาอังกฤษ) ตรงๆ
  // ลงในข้อความที่ผู้ใช้เห็น (ดู TC-504b)
  function loginErrorMessage(error) {
    const known = {
      "Invalid login credentials": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
      "Email not confirmed": "อีเมลนี้ยังไม่ได้ยืนยัน กรุณาตรวจสอบกล่องอีเมลของคุณ",
    };
    return known[error?.message] || "เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setMsg({ type: "error", text: loginErrorMessage(error) });
      setSubmitting(false);
    } else {
      router.replace("/");
    }
  }

  // ส่งอีเมลลิงก์รีเซ็ตรหัสผ่าน (ใช้ resetPasswordForEmail ของ Supabase) — ไม่บอกว่าอีเมลนี้
  // มีในระบบไหม (กันเดา/สแกนอีเมลผู้ใช้) แสดงข้อความสำเร็จเหมือนกันทุกกรณี
  async function handleForgotSubmit(e) {
    e.preventDefault();
    setForgotSubmitting(true);
    setForgotMsg(null);

    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      setForgotMsg({ type: "error", text: "ส่งลิงก์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
    } else {
      setForgotMsg({
        type: "success",
        text: "ถ้าอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว — ตรวจสอบกล่องอีเมล (รวมถึง Junk/Spam)",
      });
    }
    setForgotSubmitting(false);
  }

  return (
    <div className="container" style={{ maxWidth: 400, paddingTop: 60 }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>
        <h1 style={{ fontSize: 20 }}>เข้าสู่ระบบสต็อกอะไหล่</h1>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          อีเมล
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </label>
        <label>
          รหัสผ่าน
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button
          type="button"
          onClick={() => {
            setShowForgot((v) => !v);
            setForgotMsg(null);
          }}
          style={{ background: "none", border: "none", color: "var(--link)", fontSize: 13, cursor: "pointer" }}
        >
          ลืมรหัสผ่าน?
        </button>
      </div>

      {showForgot && (
        <form
          onSubmit={handleForgotSubmit}
          style={{
            marginTop: 8,
            padding: 12,
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
          }}
        >
          <label style={{ fontSize: 13 }}>
            กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้
            <input
              id="forgot_email"
              type="email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="name@example.com"
            />
          </label>
          {forgotMsg && (
            <div className={`msg ${forgotMsg.type}`} style={{ marginBottom: 8, fontSize: 13 }}>
              {forgotMsg.text}
            </div>
          )}
          <button type="submit" disabled={forgotSubmitting}>
            {forgotSubmitting ? "กำลังส่ง..." : "ส่งลิงก์ตั้งรหัสผ่านใหม่"}
          </button>
        </form>
      )}

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "var(--text-muted)" }}>
        ยังไม่มีบัญชี?{" "}
        <Link href="/signup" style={{ color: "var(--link)" }}>
          สร้างอู่ใหม่
        </Link>
      </div>

      <div style={{ textAlign: "center", marginTop: 8, fontSize: 13, color: "var(--text-muted)" }}>
        เป็นหัวหน้างาน/ช่าง/ผู้ช่วยช่าง?{" "}
        <Link href="/staff-login" style={{ color: "var(--link)" }}>
          เข้าสู่ระบบด้วย username + PIN
        </Link>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="container" style={{ maxWidth: 400, paddingTop: 60 }}>
          <div className="empty">กำลังโหลด...</div>
        </div>
      }
    >
      <LoginFormContent />
    </Suspense>
  );
}
