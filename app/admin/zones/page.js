"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";

export default function ZonesAdminPage() {
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    fetchZones();
  }, []);

  async function fetchZones() {
    setLoading(true);
    const { data, error } = await supabase
      .from("zones")
      .select("*")
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
      code: newCode.trim(),
      name: newName.trim() || null,
    });

    if (error) {
      setMsg({ type: "error", text: "เพิ่มโซนไม่สำเร็จ: " + error.message });
    } else {
      setNewCode("");
      setNewName("");
      setMsg({ type: "success", text: "เพิ่มโซนแล้ว ✅" });
      fetchZones();
    }
    setSaving(false);
  }

  async function handleDelete(zone) {
    const confirmed = window.confirm(`ลบโซน "${zone.code}" ใช่ไหม?`);
    if (!confirmed) return;

    const { error } = await supabase.from("zones").delete().eq("id", zone.id);
    if (error) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + error.message });
    } else {
      fetchZones();
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ จัดการโซนจัดเก็บ</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleAdd} style={{ marginBottom: 24 }}>
        <label>
          รหัสโซน *
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder="เช่น JP-A1"
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
        <button type="submit" disabled={saving}>
          {saving ? "กำลังเพิ่ม..." : "+ เพิ่มโซนใหม่"}
        </button>
      </form>

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && zones.length === 0 && (
        <div className="empty">ยังไม่มีโซนในระบบ — เพิ่มโซนแรกด้านบนได้เลย</div>
      )}

      {zones.map((z) => (
        <div
          className="card"
          key={z.id}
          style={{ cursor: "default", alignItems: "center", justifyContent: "space-between" }}
        >
          <div className="card-body">
            <div className="card-title">{z.code}</div>
            {z.name && <div className="card-sub">{z.name}</div>}
          </div>
          <button
            type="button"
            onClick={() => handleDelete(z)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid #7f1d1d",
              background: "transparent",
              color: "#fca5a5",
              fontSize: 13,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ลบ
          </button>
        </div>
      ))}
    </div>
  );
}
