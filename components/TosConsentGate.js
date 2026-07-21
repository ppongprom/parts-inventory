"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../lib/AuthProvider";
import { CURRENT_TOS_VERSION, TOS_CONTENT } from "../config/tosContent";

// การ์ด "กลไก ToS consent — สัญญาใช้บริการ + บันทึกการยอมรับ (blocker #2 ของ Accounting)"
// เช็คว่าร้านนี้ยอมรับ ToS เวอร์ชันล่าสุดหรือยัง ถ้ายัง — บล็อกไม่ให้เข้าใช้งานหลักจนกว่าจะยอมรับ
// (✅ ตัดสินใจแล้ว: สมัครใหม่ต้องยอมรับก่อนใช้ / ร้านเดิมเจอ modal ครั้งแรกหลัง deploy)
// เฉพาะ owner เท่านั้นที่กดยอมรับได้ — role อื่นเห็นข้อความให้รอ/ติดต่อ owner (เห็น gate เหมือนกัน
// แต่ไม่มีปุ่มกด — ตรงกับ test scenario ในการ์ด)
export default function TosConsentGate({ children }) {
  const { currentShopId, currentRole } = useAuth();
  const [status, setStatus] = useState("loading"); // loading | needs_accept | accepted
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState(null);
  const [agreedCheckbox, setAgreedCheckbox] = useState(false);

  useEffect(() => {
    if (!currentShopId) return;
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function checkStatus() {
    setStatus("loading");
    const { data } = await supabase
      .from("shop_tos_acceptances")
      .select("tos_version, accepted_at")
      .eq("shop_id", currentShopId)
      .eq("tos_version", CURRENT_TOS_VERSION)
      .order("accepted_at", { ascending: false })
      .limit(1);
    setStatus(data && data.length > 0 ? "accepted" : "needs_accept");
  }

  async function handleAccept() {
    setAccepting(true);
    setError(null);
    const { error: rpcError } = await supabase.rpc("accept_shop_tos", {
      p_shop_id: currentShopId,
      p_version: CURRENT_TOS_VERSION,
    });
    if (rpcError) {
      setError(rpcError.message);
      setAccepting(false);
    } else {
      setStatus("accepted");
      setAccepting(false);
    }
  }

  if (!currentShopId || status === "loading") {
    return children; // ยังไม่รู้ shop/สถานะ — ไม่บล็อกระหว่างโหลด กันหน้าขาวค้างนานเกินจำเป็น
  }

  if (status === "accepted") {
    return children;
  }

  return (
    <div
      data-testid="tos-consent-gate"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          padding: 20,
          maxWidth: 480,
          width: "100%",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <h2 style={{ fontSize: 16, margin: 0 }}>📜 สัญญาใช้บริการ (อัปเดตแล้ว)</h2>

        <div
          data-testid="tos-content-box"
          style={{
            whiteSpace: "pre-wrap",
            fontSize: 12,
            lineHeight: 1.6,
            overflowY: "auto",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: 12,
            flex: 1,
          }}
        >
          {TOS_CONTENT}
        </div>

        {error && <div className="msg error">{error}</div>}

        {currentRole === "owner" ? (
          <>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={agreedCheckbox}
                onChange={(e) => setAgreedCheckbox(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>ฉันได้อ่านและยอมรับเงื่อนไขการใช้บริการฉบับนี้แล้ว</span>
            </label>
            <button type="button" onClick={handleAccept} disabled={!agreedCheckbox || accepting}>
              {accepting ? "กำลังบันทึก..." : "ยอมรับเงื่อนไข"}
            </button>
          </>
        ) : (
          <div data-testid="tos-non-owner-message" style={{ fontSize: 13, color: "var(--text-muted)" }}>
            ร้านนี้ต้องให้ <strong>เจ้าของร้าน</strong> ยอมรับเงื่อนไขการใช้บริการฉบับใหม่ก่อน ถึงจะใช้งาน
            ต่อได้ — กรุณาติดต่อเจ้าของร้าน
          </div>
        )}
      </div>
    </div>
  );
}
