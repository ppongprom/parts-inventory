"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { deletePartPhotos } from "../../../lib/storageHelpers";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

function TrashAdminPageContent() {
  const { currentShopId } = useAuth();
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    if (currentShopId) fetchTrash();
  }, [currentShopId]);

  async function fetchTrash() {
    setLoading(true);
    const { data, error } = await supabase
      .from("parts")
      .select("*")
      .eq("shop_id", currentShopId)
      .eq("is_active", false)
      .order("created_at", { ascending: false });

    if (error) {
      setMsg({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ: " + error.message });
    } else {
      setParts(data || []);
    }
    setLoading(false);
  }

  async function handleRestore(part) {
    setBusyId(part.id);
    const { error } = await supabase
      .from("parts")
      .update({ is_active: true })
      .eq("id", part.id);

    if (error) {
      setMsg({ type: "error", text: "กู้คืนไม่สำเร็จ: " + error.message });
    } else {
      setMsg({ type: "success", text: `กู้คืน "${part.part_name}" แล้ว ✅` });
      fetchTrash();
    }
    setBusyId(null);
  }

  async function handlePermanentDelete(part) {
    const confirmed = window.confirm(
      `ลบ "${part.part_name}" ถาวรใช่ไหม?\n\nการลบนี้กู้คืนไม่ได้ และรูปภาพทั้งหมดจะถูกลบออกจาก storage ด้วย`
    );
    if (!confirmed) return;

    setBusyId(part.id);

    try {
      const photos = part.photo_urls?.length
        ? part.photo_urls
        : part.photo_url
        ? [part.photo_url]
        : [];
      await deletePartPhotos(photos);

      const { error } = await supabase.from("parts").delete().eq("id", part.id);
      if (error) throw error;

      setMsg({ type: "success", text: `ลบ "${part.part_name}" ถาวรแล้ว` });
      fetchTrash();
    } catch (err) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + err.message });
    } finally {
      setBusyId(null);
    }
  }

  return (
      <div className="container">
      <div className="header">
        <h1>🗑️ ถังขยะ</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && parts.length === 0 && (
        <div className="empty">ไม่มีอะไหล่ในถังขยะ</div>
      )}

      {parts.map((p) => (
        <div className="card" key={p.id} style={{ cursor: "default" }}>
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo_url} alt={p.part_name} />
          ) : (
            <div className="no-photo">ไม่มีรูป</div>
          )}
          <div className="card-body" style={{ flex: 1 }}>
            <div className="card-title">{p.part_name}</div>
            <div className="card-sub">
              {p.car_brand} {p.car_model} {p.car_year ? `(${p.car_year})` : ""}
            </div>
            {/* การ์ด "Salvage vehicle cost allocation" edge case 1 — แยกให้เห็นชัดว่าอันไหนถูก
                "ตัดเป็นค่าเสียหาย" (write-off, มีเหตุผล+หลักฐานทางบัญชี) ต่างจากแค่ซ่อนไว้เฉยๆ */}
            {p.write_off_reason && (
              <div className="card-sub" data-testid={`write-off-badge-${p.id}`} style={{ color: "var(--danger-text)" }}>
                📉 ตัดเป็นค่าเสียหาย: {p.write_off_reason}
                {p.written_off_at && ` (${new Date(p.written_off_at).toLocaleDateString("th-TH")})`}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => handleRestore(p)}
                disabled={busyId === p.id}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#2563eb",
                  color: "white",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ↩️ กู้คืน
              </button>
              <button
                type="button"
                onClick={() => handlePermanentDelete(p)}
                disabled={busyId === p.id}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--danger-border)",
                  background: "transparent",
                  color: "var(--danger-text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                ลบถาวร
              </button>
            </div>
          </div>
        </div>
      ))}
      </div>
  );
}

export default function TrashAdminPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]} requiredFeature="admin_basic">
      <TrashAdminPageContent />
    </RequireAuth>
  );
}
