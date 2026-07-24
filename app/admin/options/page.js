"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

const CATEGORIES = [
  { key: "condition", label: "สภาพ" },
  { key: "source_type", label: "ที่มา" },
  { key: "status", label: "สถานะ" },
];

function OptionsAdminPageContent() {
  const { currentShopId } = useAuth();
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [newValues, setNewValues] = useState({
    condition: "",
    source_type: "",
    status: "",
  });
  const [saving, setSaving] = useState(null); // category ที่กำลังบันทึก

  useEffect(() => {
    if (currentShopId) fetchOptions();
  }, [currentShopId]);

  async function fetchOptions() {
    setLoading(true);
    const { data, error } = await supabase
      .from("options")
      .select("*")
      .eq("shop_id", currentShopId)
      .order("sort_order", { ascending: true });

    if (error) {
      setMsg({ type: "error", text: "โหลดตัวเลือกไม่สำเร็จ: " + error.message });
    } else {
      setOptions(data || []);
    }
    setLoading(false);
  }

  async function handleAdd(category) {
    const value = (newValues[category] || "").trim();
    if (!value) return;

    setSaving(category);
    setMsg(null);

    const maxSort = options
      .filter((o) => o.category === category)
      .reduce((max, o) => Math.max(max, o.sort_order || 0), 0);

    const { error } = await supabase.from("options").insert({
      shop_id: currentShopId,
      category,
      value,
      sort_order: maxSort + 1,
    });

    if (error) {
      setMsg({ type: "error", text: "เพิ่มไม่สำเร็จ: " + error.message });
    } else {
      setNewValues((v) => ({ ...v, [category]: "" }));
      fetchOptions();
    }
    setSaving(null);
  }

  async function handleDelete(option) {
    const confirmed = window.confirm(`ลบ "${option.value}" ใช่ไหม?`);
    if (!confirmed) return;

    const { error } = await supabase.from("options").delete().eq("id", option.id);
    if (error) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + error.message });
    } else {
      fetchOptions();
    }
  }

  return (
      <div className="container">
      <div className="header">
        <h1>⚙️ จัดการตัวเลือก</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading &&
        CATEGORIES.map((cat) => {
          const items = options.filter((o) => o.category === cat.key);
          return (
            <div key={cat.key} style={{ marginBottom: 32 }}>
              <h2 style={{ fontSize: 16, marginBottom: 10 }}>{cat.label}</h2>

              <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                <input
                  type="text"
                  value={newValues[cat.key]}
                  onChange={(e) =>
                    setNewValues((v) => ({ ...v, [cat.key]: e.target.value }))
                  }
                  placeholder={`เพิ่ม${cat.label}ใหม่`}
                  style={{ flex: 1 }}
                />
                <button
                  type="button"
                  onClick={() => handleAdd(cat.key)}
                  disabled={saving === cat.key}
                  style={{
                    padding: "0 16px",
                    borderRadius: 8,
                    border: "none",
                    background: "#2563eb",
                    color: "white",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {saving === cat.key ? "..." : "+ เพิ่ม"}
                </button>
              </div>

              {items.length === 0 && (
                <div className="empty" style={{ padding: 16 }}>
                  ยังไม่มีตัวเลือกในหมวดนี้
                </div>
              )}

              {items.map((o) => (
                <div
                  className="card"
                  key={o.id}
                  style={{
                    cursor: "default",
                    padding: "10px 12px",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div className="card-body" style={{ gap: 0 }}>
                    <div className="card-title" style={{ fontSize: 14 }}>
                      {o.value}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(o)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--danger-border)",
                      background: "transparent",
                      color: "var(--danger-text)",
                      fontSize: 12,
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
        })}
      </div>
  );
}

export default function OptionsAdminPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]} requiredFeature="admin_basic">
      <OptionsAdminPageContent />
    </RequireAuth>
  );
}
