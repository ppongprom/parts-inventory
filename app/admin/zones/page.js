"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import { getChildren, getAncestorChain } from "../../../lib/zoneHelpers";

const OWNER_TYPE_LABELS = {
  own: "ของร้านเอง",
  consignment: "ฝากขาย",
  investor: "นักลงทุนร่วม",
};

function ZonesAdminPageContent() {
  const { currentShopId } = useAuth();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const [currentParentId, setCurrentParentId] = useState(null); // null = ระดับบนสุด (Area)

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newOwnerType, setNewOwnerType] = useState("own");

  useEffect(() => {
    if (currentShopId) fetchZones();
  }, [currentShopId]);

  async function fetchZones() {
    setLoading(true);
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .eq("shop_id", currentShopId)
      .order("code", { ascending: true });

    if (error) {
      setMsg({ type: "error", text: "โหลดโซนไม่สำเร็จ: " + error.message });
    } else {
      setZones(data || []);
    }
    setLoading(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!newCode.trim()) return;

    setSaving(true);
    setMsg(null);

    const { error } = await supabase.from("zones").insert({
      shop_id: currentShopId,
      parent_id: currentParentId,
      code: newCode.trim(),
      name: newName.trim() || null,
      owner_type: newOwnerType,
    });

    if (error) {
      const friendly = error.message.includes("zones_unique_code_per_parent")
        ? `รหัส "${newCode.trim()}" ซ้ำกับโซนอื่นที่อยู่ในระดับเดียวกันนี้แล้ว`
        : error.message;
      setMsg({ type: "error", text: "เพิ่มโซนไม่สำเร็จ: " + friendly });
    } else {
      setNewCode("");
      setNewName("");
      setNewOwnerType("own");
      setMsg({ type: "success", text: "เพิ่มโซนแล้ว ✅" });
      fetchZones();
    }
    setSaving(false);
  }

  async function handleDelete(zone) {
    setMsg(null);

    // เช็คก่อนว่ามีอะไรอยู่ข้างในไหม (โซนย่อย หรือ อะไหล่ที่ผูกกับโซนนี้โดยตรง)
    const [childrenRes, partsRes] = await Promise.all([
      supabase.from("zones").select("id, code, name").eq("parent_id", zone.id),
      supabase.from("parts").select("id, part_name").eq("zone_id", zone.id).limit(20),
    ]);

    const children = childrenRes.data || [];
    const partsInside = partsRes.data || [];

    if (children.length > 0 || partsInside.length > 0) {
      const lines = [
        ...children.map((c) => `• โซนย่อย: ${c.code}${c.name ? " — " + c.name : ""}`),
        ...partsInside.map((p) => `• อะไหล่: ${p.part_name}`),
      ];
      setMsg({
        type: "error",
        text: `ลบ "${zone.code}" ไม่ได้ — ยังมีของอยู่ข้างใน ย้ายหรือลบสิ่งเหล่านี้ก่อน:\n${lines.join("\n")}`,
      });
      return;
    }

    const confirmed = window.confirm(`ลบโซน "${zone.code}" ใช่ไหม? (ไม่มีอะไรอยู่ข้างในแล้ว)`);
    if (!confirmed) return;

    const { error } = await supabase.from("zones").delete().eq("id", zone.id);
    if (error) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + error.message });
    } else {
      setMsg({ type: "success", text: "ลบแล้ว ✅" });
      fetchZones();
    }
  }

  const breadcrumb = currentParentId ? getAncestorChain(zones, currentParentId) : [];
  const visibleZones = getChildren(zones, currentParentId);
  const levelDepth = breadcrumb.length; // 0 = กำลังดู Area ชั้นบนสุด

  const LEVEL_NAME = ["โซน (Area)", "ชั้น/แร็ค (Rack)", "ระดับ (Level)"];
  const currentLevelLabel = LEVEL_NAME[levelDepth] || `ระดับย่อย ${levelDepth + 1}`;

  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ จัดการโซนจัดเก็บ</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {/* breadcrumb ไล่ชั้น */}
      <div style={{ marginBottom: 12, fontSize: 13, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        <button
          type="button"
          onClick={() => setCurrentParentId(null)}
          style={{ background: "none", border: "none", color: "var(--link)", cursor: "pointer", padding: 0, fontSize: 13 }}
        >
          🏠 ทั้งหมด
        </button>
        {breadcrumb.map((z) => (
          <span key={z.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "var(--text-muted)" }}>›</span>
            <button
              type="button"
              onClick={() => setCurrentParentId(z.id)}
              style={{ background: "none", border: "none", color: "var(--link)", cursor: "pointer", padding: 0, fontSize: 13 }}
            >
              {z.code}
            </button>
          </span>
        ))}
      </div>

      {msg && (
        <div className={`msg ${msg.type}`} style={{ marginBottom: 16, whiteSpace: "pre-line" }}>
          {msg.text}
        </div>
      )}

      <form onSubmit={handleAdd} style={{ marginBottom: 24 }}>
        <label>
          รหัส{currentLevelLabel}ใหม่ *
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={levelDepth === 0 ? "เช่น A1" : "เช่น R2 หรือ L3"}
            required
          />
        </label>
        <label>
          ชื่อ/คำอธิบาย (ไม่บังคับ)
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="เช่น โซนรถญี่ปุ่น แถว A ช่อง 1"
          />
        </label>
        <label>
          เจ้าของของในโซนนี้ (ค่าเริ่มต้นของอะไหล่ที่เพิ่มใหม่ในนี้)
          <select value={newOwnerType} onChange={(e) => setNewOwnerType(e.target.value)}>
            {Object.entries(OWNER_TYPE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "กำลังเพิ่ม..." : `+ เพิ่ม${currentLevelLabel}`}
        </button>
      </form>

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && visibleZones.length === 0 && (
        <div className="empty">
          {levelDepth === 0 ? "ยังไม่มีโซนในระบบ — เพิ่มโซนแรกด้านบนได้เลย" : "ยังไม่มีโซนย่อยในนี้ — เพิ่มด้านบนได้เลย"}
        </div>
      )}

      {visibleZones.map((z) => {
        const childCount = getChildren(zones, z.id).length;
        return (
          <div
            className="card"
            key={z.id}
            style={{ cursor: "default", alignItems: "center", justifyContent: "space-between" }}
          >
            <div
              className="card-body"
              style={{ cursor: "pointer" }}
              onClick={() => setCurrentParentId(z.id)}
            >
              <div className="card-title">
                {z.code} {childCount > 0 && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>({childCount} โซนย่อย) ›</span>}
              </div>
              <div className="card-sub">
                {z.name && <>{z.name} · </>}
                {OWNER_TYPE_LABELS[z.owner_type] || z.owner_type}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(z)}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--danger-border)",
                background: "transparent",
                color: "var(--danger-text)",
                fontSize: 13,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              ลบ
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function ZonesAdminPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]}>
      <ZonesAdminPageContent />
    </RequireAuth>
  );
}
