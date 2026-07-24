"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

// แต่ละ field ที่รองรับ bulk update — ผูกกับ master data คนละตาราง
const FIELDS = [
  { key: "condition", label: "สภาพ", masterTable: "options", masterColumn: "value", category: "condition" },
  { key: "source_type", label: "ที่มา", masterTable: "options", masterColumn: "value", category: "source_type" },
  { key: "status", label: "สถานะ", masterTable: "options", masterColumn: "value", category: "status" },
  { key: "zone_code", label: "โซนจัดเก็บ", masterTable: "zones", masterColumn: "code", category: null },
];

function BulkUpdatePageContent() {
  const { currentShopId } = useAuth();

  const [fieldKey, setFieldKey] = useState(FIELDS[0].key);
  const field = FIELDS.find((f) => f.key === fieldKey);

  const [valueCounts, setValueCounts] = useState([]); // [{ value, count }]
  const [loadingValues, setLoadingValues] = useState(true);

  const [oldValue, setOldValue] = useState("");
  const [newValue, setNewValue] = useState("");
  const [alsoUpdateMaster, setAlsoUpdateMaster] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (currentShopId) fetchValueCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId, fieldKey]);

  async function fetchValueCounts() {
    setLoadingValues(true);
    setOldValue("");
    setNewValue("");
    setMsg(null);

    const { data, error } = await supabase
      .from("parts")
      .select(field.key)
      .eq("shop_id", currentShopId)
      .not(field.key, "is", null);

    if (error) {
      setMsg({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ: " + error.message });
      setValueCounts([]);
      setLoadingValues(false);
      return;
    }

    const counts = {};
    (data || []).forEach((row) => {
      const v = row[field.key];
      counts[v] = (counts[v] || 0) + 1;
    });
    const list = Object.entries(counts)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);

    setValueCounts(list);
    setLoadingValues(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!oldValue || !newValue.trim() || oldValue === newValue.trim()) return;

    const affected = valueCounts.find((v) => v.value === oldValue)?.count || 0;
    const confirmed = window.confirm(
      `จะเปลี่ยนอะไหล่ ${affected} ชิ้น\nจาก "${oldValue}" → "${newValue.trim()}"\n\nยืนยันไหม?`
    );
    if (!confirmed) return;

    setSaving(true);
    setMsg(null);

    try {
      // 1) bulk update ที่อะไหล่ทุกชิ้นก่อน
      const { error: partsError, count } = await supabase
        .from("parts")
        .update({ [field.key]: newValue.trim() })
        .eq("shop_id", currentShopId)
        .eq(field.key, oldValue)
        .select("id", { count: "exact" });

      if (partsError) throw partsError;

      let masterNote = "";

      // 2) ถ้าติ๊กไว้ ให้ sync master data (options/zones) ให้ตรงด้วย
      if (alsoUpdateMaster) {
        // เช็คก่อนว่าค่าใหม่มีอยู่แล้วในระบบไหม (กันสร้างซ้ำ)
        let masterQuery = supabase
          .from(field.masterTable)
          .select("id")
          .eq("shop_id", currentShopId)
          .eq(field.masterColumn, newValue.trim());
        if (field.category) masterQuery = masterQuery.eq("category", field.category);
        const { data: existing } = await masterQuery.maybeSingle();

        if (existing) {
          masterNote = ` (master data มี "${newValue.trim()}" อยู่แล้ว ไม่สร้างซ้ำ)`;
        } else {
          let updateQuery = supabase
            .from(field.masterTable)
            .update({ [field.masterColumn]: newValue.trim() })
            .eq("shop_id", currentShopId)
            .eq(field.masterColumn, oldValue);
          if (field.category) updateQuery = updateQuery.eq("category", field.category);
          const { error: masterError } = await updateQuery;
          if (masterError) {
            masterNote = ` (⚠️ sync master data ไม่สำเร็จ: ${masterError.message})`;
          } else {
            masterNote = " และอัปเดต master data ให้ตรงแล้ว";
          }
        }
      }

      setMsg({
        type: "success",
        text: `เปลี่ยนอะไหล่ ${count ?? affected} ชิ้นสำเร็จ ✅${masterNote}`,
      });
      fetchValueCounts();
    } catch (err) {
      setMsg({ type: "error", text: "เปลี่ยนไม่สำเร็จ: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🔁 Bulk Update</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
        <div className="card-body" style={{ marginBottom: 10 }}>
          <div className="card-title">เปลี่ยนค่าที่อะไหล่ทุกชิ้นพร้อมกัน</div>
          <div className="card-sub">
            เลือกฟิลด์ → เลือกค่าเดิมที่จะเปลี่ยน → พิมพ์ค่าใหม่ — ระบบจะไล่แก้อะไหล่ทุกชิ้นที่ตรงเงื่อนไขให้อัตโนมัติ
          </div>
        </div>

        <label>
          ฟิลด์ที่จะ bulk update
          <select value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
            {FIELDS.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
        <div className="card-body" style={{ marginBottom: 10 }}>
          <div className="card-title">ค่าที่ใช้อยู่ตอนนี้ในอะไหล่ ({field.label})</div>
          <div className="card-sub">คลิกเลือกค่าที่จะเปลี่ยน — ตัวเลขคือจำนวนอะไหล่ที่ใช้ค่านั้นอยู่</div>
        </div>

        {loadingValues && <div className="empty">กำลังโหลด...</div>}

        {!loadingValues && valueCounts.length === 0 && (
          <div className="empty">ยังไม่มีอะไหล่ที่ตั้งค่า {field.label} ไว้เลย</div>
        )}

        {!loadingValues &&
          valueCounts.map((v) => (
            <div
              key={v.value}
              onClick={() => setOldValue(v.value)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                borderRadius: 8,
                marginBottom: 6,
                cursor: "pointer",
                border:
                  oldValue === v.value
                    ? "2px solid #2563eb"
                    : "1px solid var(--border-strong)",
                background: oldValue === v.value ? "var(--surface-alt)" : "transparent",
              }}
            >
              <span>{v.value}</span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{v.count} ชิ้น</span>
            </div>
          ))}
      </div>

      {oldValue && (
        <form
          onSubmit={handleSubmit}
          className="card"
          style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="card-body" style={{ marginBottom: 10 }}>
            <div className="card-title">
              เปลี่ยน "{oldValue}" ({valueCounts.find((v) => v.value === oldValue)?.count || 0} ชิ้น) เป็น...
            </div>
          </div>

          <label>
            ค่าใหม่ *
            <input
              type="text"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder={`เช่น ${oldValue}`}
              required
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, flexDirection: "row" }}>
            <input
              type="checkbox"
              checked={alsoUpdateMaster}
              onChange={(e) => setAlsoUpdateMaster(e.target.checked)}
              style={{ width: "auto" }}
            />
            <span>อัปเดต master data ({field.masterTable === "zones" ? "โซน" : "ตัวเลือก"}) ให้ตรงด้วย</span>
          </label>

          {msg && (
            <div className={`msg ${msg.type}`} style={{ marginTop: 10 }}>
              {msg.text}
            </div>
          )}

          <button type="submit" disabled={saving || !newValue.trim()} style={{ marginTop: 10 }}>
            {saving ? "กำลังเปลี่ยน..." : "ยืนยันเปลี่ยน"}
          </button>
        </form>
      )}
    </div>
  );
}

export default function BulkUpdatePage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]} requiredFeature="admin_basic">
      <BulkUpdatePageContent />
    </RequireAuth>
  );
}
