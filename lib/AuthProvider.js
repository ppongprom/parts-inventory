"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { registerSession, heartbeatSession, releaseSession, clearStoredSessionId } from "./sessionTracking";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [memberships, setMemberships] = useState([]); // [{ shop_id, shop_name, role, subscription_status, ... }]
  const [currentShopId, setCurrentShopId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [isDisabledAccount, setIsDisabledAccount] = useState(false);
  // การ์ด "Field Scanner Role + temp account auto-expiry" — บัญชีชั่วคราวที่ expires_at ผ่านแล้ว
  // ต้องถูกปฏิเสธตอน login พร้อมข้อความชัดเจน แยกจาก "ถูกปิดใช้งาน" (isDisabledAccount) เพราะ
  // สาเหตุ/ข้อความที่ต้องสื่อสารกับผู้ใช้ต่างกัน
  const [isExpiredAccount, setIsExpiredAccount] = useState(false);
  // การ์ด "Admin Role (7th role)" — simplify principle: หน้า/เมนู admin-approvals แสดงเฉพาะร้านที่
  // มี user role admin อยู่จริงอย่างน้อย 1 คน ร้านที่ไม่เคย invite admin ต้องไม่เห็นเมนูนี้เลย —
  // เช็คแยกจาก loadMemberships() เพราะเป็น fact ของ "อู่ที่กำลังเลือกอยู่" ไม่ใช่ของ membership ตัวเอง
  const [shopHasAdminMember, setShopHasAdminMember] = useState(false);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) loadMemberships();
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);

      // TOKEN_REFRESHED ยิงอัตโนมัติเบื้องหลังทุกครั้งที่ Supabase ต่ออายุ JWT ให้เอง
      // (รวมถึงตอนสลับกลับมาที่แท็บนี้) ไม่ใช่เหตุการณ์ที่สิทธิ์/สมาชิกภาพเปลี่ยนจริง
      // ไม่ต้องเรียก loadMemberships() ใหม่ (ซึ่ง setLoading(true) ทันที) เพราะจะทำให้จอ
      // กะพริบ "กำลังตรวจสอบสิทธิ์..." โดยไม่จำเป็น แค่ sync session object ก็พอ
      if (event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;

      if (newSession) {
        loadMemberships();
      } else {
        setMemberships([]);
        setCurrentShopId(null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadMemberships() {
    setLoading(true);
    setIsDisabledAccount(false);
    setIsExpiredAccount(false);
    // เผื่อมีคำเชิญค้างอยู่ตามอีเมล -> รับอัตโนมัติทุกครั้งที่ล็อกอิน
    await supabase.rpc("accept_pending_invites");

    const {
      data: { user: currentUser },
    } = await supabase.auth.getUser();
    if (!currentUser) {
      setMemberships([]);
      setLoading(false);
      return;
    }

    // ⚠️ สำคัญมาก: ต้องกรอง user_id ตรงนี้เอง ห้ามพึ่ง RLS อย่างเดียว
    // เพราะ policy ของ shop_members อนุญาตให้เห็น "เพื่อนร่วมอู่ทุกคน" ได้
    // (ถูกต้องแล้วสำหรับหน้าจัดการทีม) แต่ query นี้ต้องการแค่ "แถวของฉันเอง"
    // ไม่งั้นจะดึงแถวของเพื่อนร่วมอู่ (เช่น owner) มาปนด้วย ทำให้จับบทบาทผิดคน
    //
    // ⚠️ ดึงทุกสถานะ (ไม่กรอง active) ก่อน เพื่อแยกแยะ 2 เคสที่หน้าตาเหมือนกัน:
    // 1) ผู้ใช้ใหม่จริงๆ ที่ไม่เคยมีแถวเลย -> ควรไปหน้า /signup สร้างอู่แรก
    // 2) เคยมีอู่แต่ถูกปิดใช้งานหมดทุกอู่ -> ไม่ควรให้ไปสร้างอู่ใหม่หลบเลี่ยงได้
    let { data: allRows, error } = await supabase
      .from("shop_members")
      .select("member_id, shop_id, role, status, login_username, contact_name, expires_at, shops:shop_id (shop_name, subscription_status, subscription_plan, current_stock_value, stock_cap_status)")
      .eq("user_id", currentUser.id);

    const hasAnyMembershipEver = !error && allRows && allRows.length > 0;

    // เคส signup ตอนที่ยังไม่ยืนยันอีเมล -> ตอนนั้นยังไม่มี session เลยสร้างอู่ไม่ได้
    // พอกลับมาหลังยืนยันอีเมลสำเร็จ (มี session แล้ว) แต่ยังไม่มีอู่เลย
    // -> เช็คว่ามีชื่ออู่ที่ค้างไว้ใน localStorage ไหม ถ้ามีให้สร้างอู่ให้อัตโนมัติตอนนี้เลย
    // ⚠️ ทำเฉพาะกรณีไม่เคยมีแถวใน shop_members มาก่อนเลยเท่านั้น (ผู้ใช้ใหม่จริง)
    // กันคนที่เคยมีอู่แต่ถูกปิดใช้งาน เผลอไปสร้างอู่ใหม่หลบเลี่ยงได้
    if (!error && !hasAnyMembershipEver) {
      const pendingShopName =
        typeof window !== "undefined" ? localStorage.getItem("pending_shop_name") : null;

      if (pendingShopName) {
        const { error: rpcError } = await supabase.rpc("create_shop_with_owner", {
          p_shop_name: pendingShopName,
        });

        if (!rpcError) {
          localStorage.removeItem("pending_shop_name");
          // ดึงรายชื่ออู่ใหม่อีกครั้งหลังสร้างสำเร็จ (กรอง user_id เหมือนกัน)
          const refetch = await supabase
            .from("shop_members")
            .select(
              "member_id, shop_id, role, status, login_username, contact_name, expires_at, shops:shop_id (shop_name, subscription_status, subscription_plan, current_stock_value, stock_cap_status)"
            )
            .eq("user_id", currentUser.id);
          allRows = refetch.data;
          error = refetch.error;
        }
      }
    }

    const now = new Date();
    const isExpired = (m) => !!m.expires_at && new Date(m.expires_at) <= now;
    // แถว active ทั้งหมด (สถานะ active และยังไม่ครบกำหนด expires_at ถ้ามี)
    const activeRows = (allRows || []).filter((m) => m.status === "active" && !isExpired(m));

    // มีแถวอยู่จริง (เคยเป็นสมาชิก) แต่ไม่มีแถวไหน active เลย = ถูกปิดใช้งานทั้งหมด หรือหมดอายุ
    // ทั้งหมด (ไม่ใช่ผู้ใช้ใหม่ที่ไม่เคยมีอู่ กรณีนั้น allRows จะว่างเปล่าตั้งแต่ต้น ไม่ใช่ตรงนี้)
    const activeStatusRows = (allRows || []).filter((m) => m.status === "active");
    const allActiveRowsExpired = activeStatusRows.length > 0 && activeStatusRows.every((m) => isExpired(m));
    setIsExpiredAccount(allActiveRowsExpired);
    setIsDisabledAccount((allRows || []).length > 0 && activeRows.length === 0 && !allActiveRowsExpired);

    if (!error) {
      const list = activeRows.map((m) => ({
        member_id: m.member_id,
        shop_id: m.shop_id,
        role: m.role,
        login_username: m.login_username,
        contact_name: m.contact_name,
        shop_name: m.shops?.shop_name,
        subscription_status: m.shops?.subscription_status,
        subscription_plan: m.shops?.subscription_plan,
        // การ์ด "Stock Value Cap Engine" — เอาไว้เช็คแสดง banner + บล็อกฟีเจอร์บางส่วนตอนเกิน cap
        current_stock_value: m.shops?.current_stock_value,
        stock_cap_status: m.shops?.stock_cap_status,
      }));
      setMemberships(list);

      // ตั้งอู่ปัจจุบันอัตโนมัติถ้ายังไม่ได้เลือก (หรือถ้าอู่เดิมที่เคยเลือกไม่อยู่ในลิสต์แล้ว)
      setCurrentShopId((prev) => {
        if (prev && list.some((m) => m.shop_id === prev)) return prev;
        return list[0]?.shop_id || null;
      });
    }
    setLoading(false);
  }

  const switchShop = useCallback((shopId) => {
    setCurrentShopId(shopId);
  }, []);

  const currentMembership = memberships.find((m) => m.shop_id === currentShopId) || null;

  // เช็คว่าอู่ที่กำลังเลือกอยู่มี user role admin (active) อย่างน้อย 1 คนไหม — ใช้ gate เมนู
  // "รออนุมัติ"/"ตั้งค่าการขออนุมัติ" (ดู AppShell.js) pattern เดียวกับ field_scanner count ใน
  // lib/sessionTracking.js
  useEffect(() => {
    if (!currentShopId) {
      setShopHasAdminMember(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("shop_members")
      .select("member_id", { count: "exact", head: true })
      .eq("shop_id", currentShopId)
      .eq("role", "admin")
      .eq("status", "active")
      .then(({ count }) => {
        if (!cancelled) setShopHasAdminMember((count || 0) > 0);
      });
    return () => {
      cancelled = true;
    };
  }, [currentShopId]);

  // ลงทะเบียน session ทุกครั้งที่ล็อกอินสำเร็จ + เลือกอู่ชัดเจนแล้ว
  // + heartbeat ทุก 60 วิ กันถูกนับเป็น session ค้าง + คืน session ตอนออกจากระบบ/ปิดแท็บ
  useEffect(() => {
    if (!session?.user?.id || !currentShopId || !currentMembership) return;

    let cancelled = false;
    let heartbeatInterval = null;
    let localSessionId = null;

    // หน่วง 50ms ก่อนเริ่มยิง registerSession() จริง — กัน effect re-run ถี่ๆ ตอน
    // currentShopId/currentMembership กำลัง settle ค่า (เช่น subscription_plan เปลี่ยนจาก
    // undefined -> ค่าจริงภายในไม่กี่ ms หลัง memberships โหลดเสร็จ) ยิง network call ซ้อนกัน
    // จนตัวแรกโดน cancel กลางทาง — เจอจริง 22 ก.ค. 2026 ตอนทดสอบ concurrent-session ภายใต้
    // 5 worker parallel พร้อมกัน (CPU โหลดหนักขึ้นทำให้ effect fire 2 รอบชัดขึ้น): session
    // ไม่ถูกบันทึกเลยทั้ง 2 รอบ เพราะรอบแรกโดน cleanup ตัดตอน request กลางทาง (เห็นใน network
    // tab ว่า DELETE ของ registerSession() ขึ้น "canceled") — 50ms พอกันปัญหานี้โดยไม่กระทบ
    // UX เพราะผู้ใช้ไม่มีทางรู้สึกหน่วงระดับนี้ได้
    const debounceTimer = setTimeout(() => {
      (async () => {
        const result = await registerSession(
          session.user.id,
          currentShopId,
          currentMembership.subscription_plan
        );
        if (cancelled) return;

        if (!result.ok) {
          setSessionError(result.reason);
          await supabase.auth.signOut();
          return;
        }

        localSessionId = result.sessionId;
        setSessionId(result.sessionId);
        setSessionError(null);

        heartbeatInterval = setInterval(async () => {
          // การ์ด "Concurrent session limit — config ต่อ tier" — เดิม eviction แค่ลบแถวใน
          // user_sessions โดยไม่เคยตัดสิทธิ์เครื่องที่ถูกเขี่ยจริง (JWT เดิมยังใช้ได้ต่อจนหมดอายุเอง)
          // ตอนนี้ heartbeat เช็คว่าแถวของตัวเองยังอยู่ไหมทุกครั้ง ถ้าหายไป (ถูก evict จากเครื่องอื่น
          // ที่ login ชนกัน) ให้ signOut ทันที ไม่ปล่อยให้ใช้งานต่อเงียบๆ
          const stillActive = await heartbeatSession(localSessionId);
          if (!stillActive && !cancelled) {
            setSessionError("บัญชีนี้ถูกเข้าใช้งานจากอุปกรณ์อื่นเกินจำนวนที่แพ็กเกจอนุญาต เซสชันนี้ถูกตัดออกแล้ว");
            if (heartbeatInterval) clearInterval(heartbeatInterval);
            // แถวถูกลบไปแล้วจริง (evicted) — เคลียร์ sessionStorage ทิ้งด้วย ไม่งั้น
            // x-session-id เก่าที่ไม่มีแถวคู่กันแล้วจะยังถูกแนบไปกับ API call ถัดไปอยู่ (เช็คที่
            // lib/teamAuth.js verifyCaller() จะ reject อยู่ดี แต่เคลียร์ให้ตรงสถานะจริงดีกว่า)
            clearStoredSessionId();
            await supabase.auth.signOut();
          }
        }, 60 * 1000);
      })();
    }, 50);

    const handleUnload = () => {
      if (localSessionId) releaseSession(localSessionId);
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      cancelled = true;
      clearTimeout(debounceTimer);
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      window.removeEventListener("beforeunload", handleUnload);
      if (localSessionId) releaseSession(localSessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, currentShopId, currentMembership?.subscription_plan]);

  const signOut = useCallback(async () => {
    if (sessionId) await releaseSession(sessionId);
    await supabase.auth.signOut();
  }, [sessionId]);

  const value = {
    loading,
    session,
    user: session?.user || null,
    memberships,
    currentShopId,
    currentRole: currentMembership?.role || null,
    currentShop: currentMembership,
    switchShop,
    signOut,
    refreshMemberships: loadMemberships,
    sessionError,
    isDisabledAccount,
    isExpiredAccount,
    shopHasAdminMember,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth ต้องใช้ภายใน <AuthProvider>");
  return ctx;
}
