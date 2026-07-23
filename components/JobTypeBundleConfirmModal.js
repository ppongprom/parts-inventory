"use client";

import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

const CATEGORY_LABELS = { labor: "ค่าแรง", parts: "ค่าอะไหล่", other: "อื่นๆ" };

function emptyItem() {
  return {
    category: "parts",
    item_group_label: "",
    description: "",
    default_amount: "",
    default_quantity: "1",
    is_price_locked: true,
    part_id: null,
    variants: [],
  };
}

function emptyVariant() {
  return { variant_label: "", description: "", default_amount: "", default_quantity: "1", part_id: null };
}

// การ์ด "Job Type Bundle Template" — Dev note: "ต้องออกแบบ modal/screen 'ยืนยันก่อน save' ใหม่ —
// แสดงรายการทั้งหมดในเซตที่กำลังจะถูกบันทึกเป็น preset ใหม่ ให้แก้ไข/ลบรายการได้ก่อนกด Save จริง"
// เฉพาะ Owner/Manager/Admin เท่านั้นที่เห็น modal นี้ (Technician ไม่มีทาง trigger ได้ — เลือกจาก
// preset ที่มีอยู่แล้วเสมอ ไม่มีปุ่ม "สร้างชุดใหม่")
export default function JobTypeBundleConfirmModal({ initialJobTypeName, shopId, onCancel, onSave, saving }) {
  const [jobTypeName, setJobTypeName] = useState(initialJobTypeName || "");
  const [items, setItems] = useState([emptyItem()]);

  // ค้นหาอะไหล่จากสต็อกมาผูกกับรายการ/sub-variant — key เป็น "item-<i>" หรือ "variant-<i>-<vi>"
  // แยกจาก items state เพราะเป็นแค่ query/ผลลัพธ์ชั่วคราว ไม่ต้องส่งไป onSave
  const [partQueries, setPartQueries] = useState({});
  const [partResults, setPartResults] = useState({});

  async function searchParts(key, query) {
    setPartQueries((q) => ({ ...q, [key]: query }));
    if (!query.trim() || !shopId) {
      setPartResults((r) => ({ ...r, [key]: [] }));
      return;
    }
    const { data } = await supabase
      .from("parts")
      .select("id, part_name, price, quantity, item_type")
      .eq("shop_id", shopId)
      .in("item_type", ["consumable", "salvage"])
      .eq("is_active", true)
      .gt("quantity", 0)
      .ilike("part_name", `%${query.trim()}%`)
      .limit(8);
    setPartResults((r) => ({ ...r, [key]: data || [] }));
  }

  function clearPartSearch(key) {
    setPartQueries((q) => ({ ...q, [key]: "" }));
    setPartResults((r) => ({ ...r, [key]: [] }));
  }

  function updateItem(index, patch) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }
  function removeItem(index) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }
  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }
  function addVariant(itemIndex) {
    setItems((prev) =>
      prev.map((it, i) => (i === itemIndex ? { ...it, variants: [...it.variants, emptyVariant()] } : it))
    );
  }
  function updateVariant(itemIndex, variantIndex, patch) {
    setItems((prev) =>
      prev.map((it, i) =>
        i === itemIndex
          ? { ...it, variants: it.variants.map((v, vi) => (vi === variantIndex ? { ...v, ...patch } : v)) }
          : it
      )
    );
  }
  function removeVariant(itemIndex, variantIndex) {
    setItems((prev) =>
      prev.map((it, i) => (i === itemIndex ? { ...it, variants: it.variants.filter((_, vi) => vi !== variantIndex) } : it))
    );
  }

  // เลือกอะไหล่จากสต็อก — เติมชื่อ/รายละเอียด/ราคาให้อัตโนมัติ พร้อมผูก part_id (ยังไม่ตัดสต็อกจริง
  // ตอน save เซต — ตัดจริงตอนนำไปใช้ในงานถ้าต้องการ ต้องทำแยกอีกขั้น)
  function selectPartForItem(itemIndex, part) {
    updateItem(itemIndex, {
      item_group_label: part.part_name,
      description: part.part_name,
      default_amount: part.price != null ? String(part.price) : "",
      part_id: part.id,
    });
    clearPartSearch(`item-${itemIndex}`);
  }
  function selectPartForVariant(itemIndex, variantIndex, part) {
    updateVariant(itemIndex, variantIndex, {
      variant_label: part.part_name,
      description: part.part_name,
      default_amount: part.price != null ? String(part.price) : "",
      part_id: part.id,
    });
    clearPartSearch(`variant-${itemIndex}-${variantIndex}`);
  }

  const canSave = jobTypeName.trim() && items.length > 0 && items.every((it) => it.item_group_label.trim() && it.description.trim());

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        className="job-bundle-modal"
        style={{
          background: "var(--surface)",
          borderRadius: 12,
          padding: 20,
          maxWidth: 560,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        {/* กรอบกว้างขึ้นเฉพาะจอใหญ่ (desktop) — จอมือถือใช้ width:100% เดิม ไม่กระทบ */}
        <style jsx>{`
          @media (min-width: 901px) {
            .job-bundle-modal {
              max-width: 820px !important;
            }
          }
        `}</style>

        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>สร้างเซตใหม่ — ต้องการปรับอะไรก่อน save ไหม?</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
          รายการทั้งหมดด้านล่างจะถูกบันทึกเป็นเซต (preset) สำหรับประเภทงานนี้ — แก้ไข/ลบก่อนกด save ได้
        </div>

        <label>
          ชื่อประเภทงาน
          <input
            type="text"
            value={jobTypeName}
            onChange={(e) => setJobTypeName(e.target.value)}
            placeholder="เช่น เปลี่ยนถ่ายน้ำมันเครื่อง"
          />
        </label>

        <div style={{ marginTop: 16, fontWeight: 600, fontSize: 13 }}>รายการในเซต</div>
        {items.map((item, itemIndex) => (
          <div
            key={itemIndex}
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: 10,
              marginTop: 8,
            }}
          >
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <select
                value={item.category}
                onChange={(e) => updateItem(itemIndex, { category: e.target.value, is_price_locked: e.target.value !== "labor" })}
                style={{ width: 90 }}
              >
                {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="ชื่อรายการ เช่น น้ำมันเกียร์"
                value={item.item_group_label}
                onChange={(e) => updateItem(itemIndex, { item_group_label: e.target.value })}
                style={{ flex: 1, minWidth: 120 }}
              />
              <button type="button" onClick={() => removeItem(itemIndex)} style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}>
                ✕
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="รายละเอียด default"
                value={item.description}
                onChange={(e) => updateItem(itemIndex, { description: e.target.value, part_id: null })}
                style={{ flex: 1, minWidth: 140 }}
              />
              <input
                type="number"
                placeholder="ปริมาณ"
                value={item.default_quantity}
                onChange={(e) => updateItem(itemIndex, { default_quantity: e.target.value })}
                style={{ width: 70 }}
                min="0.01"
                step="any"
              />
              <input
                type="number"
                placeholder="ราคา"
                value={item.default_amount}
                onChange={(e) => updateItem(itemIndex, { default_amount: e.target.value })}
                style={{ width: 90 }}
              />
            </div>

            {/* ค้นหาอะไหล่จากสต็อกมาผูกกับรายการนี้ (ไม่บังคับ) — เลือกแล้วเติมชื่อ/ราคาให้อัตโนมัติ
                ใช้เมื่อรายการไม่มี sub-variant คือรายการนี้เองที่ตรงกับ SKU สต็อกตัวเดียว */}
            <div style={{ position: "relative", marginTop: 6 }}>
              <input
                type="text"
                placeholder="🔍 ค้นหาจากสต็อก (ไม่บังคับ — เลือกแล้วเติมชื่อ/ราคาให้อัตโนมัติ)"
                value={partQueries[`item-${itemIndex}`] || ""}
                onChange={(e) => searchParts(`item-${itemIndex}`, e.target.value)}
                style={{ width: "100%" }}
              />
              {(partResults[`item-${itemIndex}`] || []).length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    zIndex: 10,
                    background: "var(--surface)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: 8,
                    marginTop: 4,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {partResults[`item-${itemIndex}`].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPartForItem(itemIndex, p)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: 10,
                        border: "none",
                        borderBottom: "1px solid var(--border)",
                        background: "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        fontSize: 13,
                      }}
                    >
                      {p.item_type === "salvage" ? "🔩" : "📦"} {p.part_name} — เหลือ {p.quantity} ·{" "}
                      {p.price ? `${Number(p.price).toLocaleString()} บาท` : "ไม่มีราคา"}
                    </button>
                  ))}
                </div>
              )}
              {item.part_id && (
                <div style={{ fontSize: 11, color: "var(--zone-text)", marginTop: 4 }}>
                  🔗 ผูกกับสต็อก: {item.description}
                </div>
              )}
            </div>

            {item.variants.map((variant, variantIndex) => {
              const variantKey = `variant-${itemIndex}-${variantIndex}`;
              return (
                <div key={variantIndex} style={{ marginTop: 6, marginLeft: 16 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <input
                      type="text"
                      placeholder="ชื่อ sub-variant เช่น CVT"
                      value={variant.variant_label}
                      onChange={(e) => updateVariant(itemIndex, variantIndex, { variant_label: e.target.value })}
                      style={{ width: 100 }}
                    />
                    <input
                      type="text"
                      placeholder="รายละเอียด"
                      value={variant.description}
                      onChange={(e) => updateVariant(itemIndex, variantIndex, { description: e.target.value, part_id: null })}
                      style={{ flex: 1, minWidth: 100 }}
                    />
                    <input
                      type="number"
                      placeholder="ปริมาณ"
                      value={variant.default_quantity}
                      onChange={(e) => updateVariant(itemIndex, variantIndex, { default_quantity: e.target.value })}
                      style={{ width: 60 }}
                      min="0.01"
                      step="any"
                    />
                    <input
                      type="number"
                      placeholder="ราคา"
                      value={variant.default_amount}
                      onChange={(e) => updateVariant(itemIndex, variantIndex, { default_amount: e.target.value })}
                      style={{ width: 80 }}
                    />
                    <button
                      type="button"
                      onClick={() => removeVariant(itemIndex, variantIndex)}
                      style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* ค้นหาอะไหล่จากสต็อกมาผูกกับ sub-variant นี้ (ไม่บังคับ) */}
                  <div style={{ position: "relative", marginTop: 4 }}>
                    <input
                      type="text"
                      placeholder="🔍 ค้นหาจากสต็อก (ไม่บังคับ)"
                      value={partQueries[variantKey] || ""}
                      onChange={(e) => searchParts(variantKey, e.target.value)}
                      style={{ width: "100%" }}
                    />
                    {(partResults[variantKey] || []).length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          top: "100%",
                          left: 0,
                          right: 0,
                          zIndex: 10,
                          background: "var(--surface)",
                          border: "1px solid var(--border-strong)",
                          borderRadius: 8,
                          marginTop: 4,
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                      >
                        {partResults[variantKey].map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => selectPartForVariant(itemIndex, variantIndex, p)}
                            style={{
                              display: "block",
                              width: "100%",
                              textAlign: "left",
                              padding: 10,
                              border: "none",
                              borderBottom: "1px solid var(--border)",
                              background: "transparent",
                              color: "var(--text)",
                              cursor: "pointer",
                              fontSize: 13,
                            }}
                          >
                            {p.item_type === "salvage" ? "🔩" : "📦"} {p.part_name} — เหลือ {p.quantity} ·{" "}
                            {p.price ? `${Number(p.price).toLocaleString()} บาท` : "ไม่มีราคา"}
                          </button>
                        ))}
                      </div>
                    )}
                    {variant.part_id && (
                      <div style={{ fontSize: 11, color: "var(--zone-text)", marginTop: 4 }}>
                        🔗 ผูกกับสต็อก: {variant.description}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => addVariant(itemIndex)}
              style={{ marginTop: 6, marginLeft: 16, fontSize: 12, border: "none", background: "transparent", color: "#2563eb", cursor: "pointer" }}
            >
              + เพิ่ม sub-variant
            </button>
          </div>
        ))}

        <button type="button" onClick={addItem} style={{ marginTop: 10, fontSize: 13 }}>
          + เพิ่มรายการ
        </button>

        <div style={{ display: "flex", gap: 8, marginTop: 20, justifyContent: "flex-end" }}>
          <button type="button" onClick={onCancel} disabled={saving}>
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => onSave(jobTypeName.trim(), items)}
            disabled={!canSave || saving}
            style={{ background: "#2563eb", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" }}
          >
            {saving ? "กำลังบันทึก..." : "บันทึกเซตนี้"}
          </button>
        </div>
      </div>
    </div>
  );
}
