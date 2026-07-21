"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import { getChildren, getAncestorChain, getSortedZoneList } from "../../../lib/zoneHelpers";
import ZoneTreeNode from "../../../components/ZoneTreeNode";

const OWNER_TYPE_LABELS = {
  own: "ของร้านเอง",
  consignment: "ฝากขาย",
  investor: "นักลงทุนร่วม",
};

const LEVEL_NAME = ["โซน (Area)", "ชั้น/แร็ค (Rack)", "ระดับ (Level)"];
// sentinel แทน "เพิ่ม Area บนสุด" เพื่อไม่ให้ชนกับ null (null = ไม่มีฟอร์ม add เปิดอยู่)
const ROOT_LEVEL = "__root__";

function levelLabelForIndex(idx) {
  return LEVEL_NAME[idx] || `ระดับย่อย ${idx + 1}`;
}

function ZonesAdminPageContent() {
  const router = useRouter();
  const { currentShopId } = useAuth();
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  // ขยาย/ย่อ ทีละโหนด — เก็บเป็น set ของ zone.id ที่ "ขยายอยู่" (default ย่อทั้งหมด)
  const [expandedIds, setExpandedIds] = useState(new Set());

  // ฟอร์ม add เปิดอยู่ใต้โหนดไหน: null = ปิด, ROOT_LEVEL = เพิ่ม Area บนสุด, หรือ zone.id
  const [addingUnderId, setAddingUnderId] = useState(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newOwnerType, setNewOwnerType] = useState("own");

  // แก้ไขโซนที่มีอยู่แล้ว (code/name/owner_type — ไม่ย้าย parent ในรอบนี้
  // เพราะการย้าย parent ต้อง recalculate ltree path ของตัวเองและลูกหลานทั้งหมดด้วย)
  const [editingZoneId, setEditingZoneId] = useState(null);
  const [editCode, setEditCode] = useState("");
  const [editName, setEditName] = useState("");
  const [editOwnerType, setEditOwnerType] = useState("own");
  const [savingEdit, setSavingEdit] = useState(false);

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

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setExpandedIds(new Set(zones.map((z) => z.id)));
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }

  function startAdd(parentId) {
    setEditingZoneId(null);
    setMsg(null);
    setNewCode("");
    setNewName("");
    setNewOwnerType("own");
    setAddingUnderId(parentId);
  }

  function cancelAdd() {
    setAddingUnderId(null);
  }

  async function handleAdd(parentId) {
    if (!newCode.trim()) return;

    setSaving(true);
    setMsg(null);

    const dbParentId = parentId === ROOT_LEVEL ? null : parentId;

    const { error } = await supabase.from("zones").insert({
      shop_id: currentShopId,
      parent_id: dbParentId,
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
      setMsg({ type: "success", text: "เพิ่มโซนแล้ว ✅" });
      // ขยายโหนดพ่อให้เห็นลูกใหม่ทันที (ถ้าไม่ใช่ root)
      if (dbParentId) {
        setExpandedIds((prev) => new Set([...prev, dbParentId]));
      }
      setAddingUnderId(null);
      fetchZones();
    }
    setSaving(false);
  }

  function startEdit(zone) {
    setAddingUnderId(null);
    setEditingZoneId(zone.id);
    setEditCode(zone.code);
    setEditName(zone.name || "");
    setEditOwnerType(zone.owner_type);
    setMsg(null);
  }

  function cancelEdit() {
    setEditingZoneId(null);
  }

  async function handleEditSubmit(e) {
    e.preventDefault();
    if (!editCode.trim()) return;

    setSavingEdit(true);
    setMsg(null);

    const { error } = await supabase
      .from("zones")
      .update({
        code: editCode.trim(),
        name: editName.trim() || null,
        owner_type: editOwnerType,
      })
      .eq("id", editingZoneId);

    if (error) {
      const friendly = error.message.includes("zones_unique_code_per_parent")
        ? `รหัส "${editCode.trim()}" ซ้ำกับโซนอื่นที่อยู่ในระดับเดียวกันนี้แล้ว`
        : error.message;
      setMsg({ type: "error", text: "แก้ไขโซนไม่สำเร็จ: " + friendly });
    } else {
      setEditingZoneId(null);
      setMsg({ type: "success", text: "แก้ไขโซนแล้ว ✅" });
      fetchZones();
    }
    setSavingEdit(false);
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

  function renderAddForm(parentId) {
    const idx = parentId === ROOT_LEVEL ? 0 : getAncestorChain(zones, parentId).length;
    const label = levelLabelForIndex(idx);

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleAdd(parentId);
        }}
        className="card"
        style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 8 }}
      >
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          กำลังเพิ่ม{label}ใหม่{parentId !== ROOT_LEVEL ? " — เป็นโซนย่อยของด้านบนนี้" : " — ระดับบนสุด"}
        </div>
        <label>
          รหัส{label} *
          <input
            type="text"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value)}
            placeholder={parentId === ROOT_LEVEL ? "เช่น A1" : "เช่น R2 หรือ L3"}
            required
            autoFocus
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
            {Object.entries(OWNER_TYPE_LABELS).map(([val, l]) => (
              <option key={val} value={val}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={saving}>
            {saving ? "กำลังเพิ่ม..." : "เพิ่ม"}
          </button>
          <button
            type="button"
            onClick={cancelAdd}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ยกเลิก
          </button>
        </div>
      </form>
    );
  }

  function renderEditForm(zone) {
    const idx = getAncestorChain(zones, zone.id).length - 1;
    const label = levelLabelForIndex(idx);

    return (
      <form
        onSubmit={handleEditSubmit}
        className="card"
        style={{ cursor: "default", flexDirection: "column", alignItems: "stretch", gap: 8 }}
      >
        <label>
          รหัส{label} *
          <input
            type="text"
            value={editCode}
            onChange={(e) => setEditCode(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label>
          ชื่อ/คำอธิบาย (ไม่บังคับ)
          <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} />
        </label>
        <label>
          เจ้าของของในโซนนี้
          <select value={editOwnerType} onChange={(e) => setEditOwnerType(e.target.value)}>
            {Object.entries(OWNER_TYPE_LABELS).map(([val, l]) => (
              <option key={val} value={val}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={savingEdit}>
            {savingEdit ? "กำลังบันทึก..." : "บันทึก"}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            ยกเลิก
          </button>
        </div>
      </form>
    );
  }

  const rootZones = getChildren(zones, null);

  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ จัดการโซนจัดเก็บ</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && (
        <div className={`msg ${msg.type}`} style={{ marginBottom: 16, whiteSpace: "pre-line" }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={() => startAdd(ROOT_LEVEL)}>
          + เพิ่มโซนบนสุด (Area)
        </button>
        <button
          type="button"
          onClick={expandAll}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ขยายทั้งหมด
        </button>
        <button
          type="button"
          onClick={collapseAll}
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ย่อทั้งหมด
        </button>
        {zones.length > 0 && (
          <button
            type="button"
            onClick={() => router.push(`/print-zone-labels?ids=${getSortedZoneList(zones).map((z) => z.id).join(",")}`)}
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "transparent",
              color: "var(--text)",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            🖨️ พิมพ์ QR ทั้งหมด ({zones.length})
          </button>
        )}
        <Link
          href="/move-parts"
          className="nav-link secondary"
          style={{ fontSize: 13, display: "inline-flex", alignItems: "center" }}
        >
          📦 ย้ายอะไหล่ทั้งโซน
        </Link>
      </div>

      {addingUnderId === ROOT_LEVEL && renderAddForm(ROOT_LEVEL)}

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && rootZones.length === 0 && (
        <div className="empty">ยังไม่มีโซนในระบบ — เพิ่มโซนแรกด้านบนได้เลย</div>
      )}

      {rootZones.map((z) => (
        <ZoneTreeNode
          key={z.id}
          zone={z}
          zones={zones}
          depth={0}
          expandedIds={expandedIds}
          onToggleExpand={toggleExpand}
          editingZoneId={editingZoneId}
          addingUnderId={addingUnderId}
          onStartEdit={startEdit}
          onStartAdd={startAdd}
          onDelete={handleDelete}
          renderEditForm={renderEditForm}
          renderAddForm={renderAddForm}
          ownerTypeLabels={OWNER_TYPE_LABELS}
        />
      ))}
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
