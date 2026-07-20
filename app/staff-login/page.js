"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../../lib/AuthProvider";
import { usernameToStaffEmail, normalizeUsername } from "../../lib/staffAuth";

export default function StaffLoginPage() {
  const router = useRouter();
  const { session, loading, sessionError } = useAuth();

  const [username, setUsername] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!loading && session) {
      router.replace("/");
    }
  }, [loading, session, router]);

  // แก้บั๊ก "silent session kick" — เหมือน /login (ดูคอมเมนต์ที่นั่น) พนักงานที่ login ด้วย
  // username+PIN ก็ต้องเห็นข้อความอธิบายเหมือนกัน ไม่ใช่แค่บัญชีอีเมล
  useEffect(() => {
    if (sessionError) {
      setMsg({ type: "error", text: sessionError });
    }
  }, [sessionError]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);

    const email = usernameToStaffEmail(normalizeUsername(username));
    const { error } = await supabase.auth.signInWithPassword({ email, password: pin });

    if (error) {
      setMsg({ type: "error", text: "เข้าสู่ระบบไม่สำเร็จ — ชื่อผู้ใช้หรือ PIN ไม่ถูกต้อง" });
      setSubmitting(false);
    } else {
      router.replace("/");
    }
  }

  return (
    <div className="container" style={{ maxWidth: 400, paddingTop: 60 }}>
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔧</div>
        <h1 style={{ fontSize: 20 }}>เข้าสู่ระบบ (พนักงาน)</h1>
        <p style={{ fontSize: 13, color: "#a8adb8" }}>
          สำหรับหัวหน้างาน/ช่าง/ผู้ช่วยช่าง — login ด้วย username + PIN ที่เจ้าของอู่ตั้งให้
        </p>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="เช่น chang01"
            required
            autoComplete="username"
          />
        </label>
        <label>
          PIN / รหัสผ่าน
          <input
            type="password"
            maxLength={20}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        <button type="submit" disabled={submitting}>
          {submitting ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: "#a8adb8" }}>
        เป็นเจ้าของ/ผู้จัดการ?{" "}
        <Link href="/login" style={{ color: "#93c5fd" }}>
          เข้าสู่ระบบด้วยอีเมล
        </Link>
      </div>
    </div>
  );
}
