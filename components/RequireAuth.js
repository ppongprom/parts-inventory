"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../lib/AuthProvider";
import { supabase } from "../lib/supabaseClient";
import { hasFeature } from "../lib/featureGating";
import IdleSessionGuard from "./IdleSessionGuard";
import AppShell from "./AppShell";
import TosConsentGate from "./TosConsentGate";

export default function RequireAuth({ children, allowedRoles, requiredFeature }) {
  const router = useRouter();
  const {
    loading,
    session,
    memberships,
    currentRole,
    currentShop,
    signOut,
    isDisabledAccount,
    isExpiredAccount,
  } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!session) {
      router.replace("/login");
      return;
    }
    // ⚠️ ต้องเช็ค isDisabledAccount/isExpiredAccount ก่อนเสมอ — คนที่เคยมีอู่แต่ถูกปิดใช้งาน
    // หรือบัญชีชั่วคราวหมดอายุแล้ว ไม่ควรถูกพาไปหน้า /signup (จะสร้างอู่ใหม่หลบเลี่ยงได้)
    if (memberships.length === 0 && !isDisabledAccount && !isExpiredAccount) {
      router.replace("/signup"); // login แล้วแต่ไม่เคยมีอู่มาก่อนเลยจริงๆ ให้ไปสร้างอู่แรก
    }
  }, [loading, session, memberships, isDisabledAccount, isExpiredAccount, router]);

  // ⚠️ กันเคส sign out แล้วกด back ของ browser กลับมาหน้านี้ — browser อาจคืนหน้าจาก
  // back/forward cache (bfcache) ทั้งอันโดยไม่รัน effect ข้างบนใหม่ ทำให้เห็นเนื้อหาเดิมค้างไว้
  // ชั่วขณะทั้งที่ sign out ไปแล้วจริง (ดู TC-303) — pageshow + persisted=true คือสัญญาณว่าเพิ่ง
  // กลับมาจาก bfcache ให้ตรวจ session สดจาก Supabase อีกทีก่อนเชื่อ state เดิมที่ค้างอยู่
  useEffect(() => {
    function handlePageShow(event) {
      if (!event.persisted) return;
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) router.replace("/login");
      });
    }
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, [router]);

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังตรวจสอบสิทธิ์...</div>
      </div>
    );
  }

  if (!session) {
    return null; // กำลัง redirect ไป /login
  }

  if (isExpiredAccount) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: "center" }} data-testid="expired-account-screen">
        <div style={{ fontSize: 40, marginBottom: 8 }}>⏳</div>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>บัญชีชั่วคราวนี้หมดอายุแล้ว</h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
          ติดต่อเจ้าของ/ผู้จัดการของอู่ถ้ายังต้องใช้งานต่อ
        </p>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          ออกจากระบบ
        </button>
      </div>
    );
  }

  if (isDisabledAccount) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🚫</div>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>บัญชีนี้ถูกปิดการใช้งาน</h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
          ติดต่อเจ้าของ/ผู้จัดการของอู่เพื่อเปิดการใช้งานบัญชีนี้อีกครั้ง
        </p>
        <button
          type="button"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
          style={{
            padding: "10px 20px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--text)",
            cursor: "pointer",
          }}
        >
          ออกจากระบบ
        </button>
      </div>
    );
  }

  if (memberships.length === 0) {
    return null; // กำลัง redirect ไป /signup
  }

  if (allowedRoles && currentRole && !allowedRoles.includes(currentRole)) {
    return (
      <div className="container">
        <div className="msg error">
          บทบาท &quot;{currentRole}&quot; ของคุณไม่มีสิทธิ์เข้าหน้านี้
        </div>
      </div>
    );
  }

  // ⚠️ เช็คหลัง allowedRoles เสมอ — role ผิดควรขึ้นข้อความ role ก่อน ไม่ใช่ข้อความอัปเกรดแพ็กเกจ
  if (requiredFeature && currentShop && !hasFeature(currentShop.subscription_plan, requiredFeature)) {
    return (
      <div className="container" style={{ paddingTop: 60, textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>ฟีเจอร์นี้ยังไม่รวมอยู่ในแพ็กเกจปัจจุบัน</h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
          กรุณาอัปเกรดแพ็กเกจเพื่อใช้งานส่วนนี้
        </p>
      </div>
    );
  }

  return (
    <IdleSessionGuard
      onTimeout={async () => {
        await signOut();
        router.replace("/login?reason=idle");
      }}
    >
      <AppShell>
        <TosConsentGate>{children}</TosConsentGate>
      </AppShell>
    </IdleSessionGuard>
  );
}
