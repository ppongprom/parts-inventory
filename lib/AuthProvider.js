"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import { registerSession, heartbeatSession, releaseSession } from "./sessionTracking";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [memberships, setMemberships] = useState([]); // [{ shop_id, shop_name, role, subscription_status, ... }]
  const [currentShopId, setCurrentShopId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionError, setSessionError] = useState(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) loadMemberships();
      else setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
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
    let { data, error } = await supabase
      .from("shop_members")
      .select("member_id, shop_id, role, status, login_username, contact_name, shops:shop_id (shop_name, subscription_status, subscription_plan)")
      .eq("status", "active")
      .eq("user_id", currentUser.id);

    // เคส signup ตอนที่ยังไม่ยืนยันอีเมล -> ตอนนั้นยังไม่มี session เลยสร้างอู่ไม่ได้
    // พอกลับมาหลังยืนยันอีเมลสำเร็จ (มี session แล้ว) แต่ยังไม่มีอู่เลย
    // -> เช็คว่ามีชื่ออู่ที่ค้างไว้ใน localStorage ไหม ถ้ามีให้สร้างอู่ให้อัตโนมัติตอนนี้เลย
    if (!error && (!data || data.length === 0)) {
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
              "member_id, shop_id, role, status, login_username, contact_name, shops:shop_id (shop_name, subscription_status, subscription_plan)"
            )
            .eq("status", "active")
            .eq("user_id", currentUser.id);
          data = refetch.data;
          error = refetch.error;
        }
      }
    }

    if (!error && data) {
      const list = data.map((m) => ({
        member_id: m.member_id,
        shop_id: m.shop_id,
        role: m.role,
        login_username: m.login_username,
        contact_name: m.contact_name,
        shop_name: m.shops?.shop_name,
        subscription_status: m.shops?.subscription_status,
        subscription_plan: m.shops?.subscription_plan,
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

  // ลงทะเบียน session ทุกครั้งที่ล็อกอินสำเร็จ + เลือกอู่ชัดเจนแล้ว
  // + heartbeat ทุก 60 วิ กันถูกนับเป็น session ค้าง + คืน session ตอนออกจากระบบ/ปิดแท็บ
  useEffect(() => {
    if (!session?.user?.id || !currentShopId || !currentMembership) return;

    let cancelled = false;
    let heartbeatInterval = null;
    let localSessionId = null;

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

      heartbeatInterval = setInterval(() => {
        heartbeatSession(localSessionId);
      }, 60 * 1000);
    })();

    const handleUnload = () => {
      if (localSessionId) releaseSession(localSessionId);
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      cancelled = true;
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
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth ต้องใช้ภายใน <AuthProvider>");
  return ctx;
}
