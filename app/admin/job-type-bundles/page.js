"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import JobTypeBundleConfirmModal from "../../../components/JobTypeBundleConfirmModal";

const CATEGORY_LABELS = { labor: "ค่าแรง", parts: "ค่าอะไหล่", other: "อื่นๆ" };

// การ์ด "Job Type Bundle Template" — หน้าดู/แก้/ลบเซตที่มีอยู่แล้ว (เพิ่มเติมจากที่การ์ดขอไว้แค่
// inline flow จากหน้างาน — ยืนยันกับผู้ใช้แล้วว่าต้องการหน้านี้ด้วย) Owner/Manager/Admin เท่านั้น
// ตามตารางสิทธิ์ในการ์ด
function JobTypeBundlesPageContent() {
  const { currentShopId, user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [savingNew, setSavingNew] = useState(false);
  const [error, setError] = useState(null);

  async function loadTemplates() {
    if (!currentShopId) return;
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("job_type_bundle_templates")
      .select(
        "template_id, job_type_name, job_type_bundle_items(item_id, category, item_group_label, description, default_amount, default_quantity, is_price_locked, sort_order, job_type_bundle_item_variants(variant_id, variant_label, description, default_amount, default_quantity, sort_order))"
      )
      .eq("shop_id", currentShopId)
      .order("job_type_name");
    if (fetchError) setError(fetchError.message);
    setTemplates(data || []);
    setLoading(false);
  }

  useEffect(() => {
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function handleCreateOnly(jobTypeName, items) {
    setSavingNew(true);
    setError(null);
    try {
      const { data: template, error: templateError } = await supabase
        .from("job_type_bundle_templates")
        .insert({ shop_id: currentShopId, job_type_name: jobTypeName, created_by: user.id })
        .select("template_id")
        .single();
      if (templateError) throw templateError;

      const itemsToInsert = items.map((item, i) => ({
        template_id: template.template_id,
        category: item.category,
        item_group_label: item.item_group_label.trim(),
        description: item.description.trim(),
        default_amount: item.default_amount !== "" ? Number(item.default_amount) : null,
        default_quantity: item.default_quantity !== "" ? Number(item.default_quantity) : 1,
        is_price_locked: item.is_price_locked,
        part_id: item.part_id || null,
        sort_order: i,
      }));
      const { data: insertedItems, error: itemsError } = await supabase
        .from("job_type_bundle_items")
        .insert(itemsToInsert)
        .select("item_id");
      if (itemsError) throw itemsError;

      const variantRows = [];
      items.forEach((item, i) => {
        (item.variants || [])
          .filter((v) => v.variant_label.trim() && v.description.trim())
          .forEach((v, vi) => {
            variantRows.push({
              item_id: insertedItems[i].item_id,
              variant_label: v.variant_label.trim(),
              description: v.description.trim(),
              default_amount: v.default_amount !== "" ? Number(v.default_amount) : null,
              default_quantity: v.default_quantity !== "" ? Number(v.default_quantity) : 1,
              part_id: v.part_id || null,
              sort_order: vi,
            });
          });
      });
      if (variantRows.length > 0) {
        const { error: variantsError } = await supabase.from("job_type_bundle_item_variants").insert(variantRows);
        if (variantsError) throw variantsError;
      }

      setShowNewModal(false);
      loadTemplates();
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingNew(false);
    }
  }

  async function handleDeleteTemplate(templateId) {
    if (!confirm("ลบเซตนี้ทั้งหมด? (รายการที่เคยใช้ไปแล้วในงานเก่าจะไม่หายไป แค่ไม่มีเซตนี้ให้เลือกอีกต่อไป)")) return;
    const { error: deleteError } = await supabase.from("job_type_bundle_templates").delete().eq("template_id", templateId);
    if (deleteError) setError(deleteError.message);
    else loadTemplates();
  }

  async function handleDeleteItem(itemId) {
    const { error: deleteError } = await supabase.from("job_type_bundle_items").delete().eq("item_id", itemId);
    if (deleteError) setError(deleteError.message);
    else loadTemplates();
  }

  async function handleUpdateItemAmount(itemId, amount) {
    await supabase
      .from("job_type_bundle_items")
      .update({ default_amount: amount !== "" ? Number(amount) : null })
      .eq("item_id", itemId);
    loadTemplates();
  }

  async function handleUpdateItemQuantity(itemId, quantity) {
    await supabase
      .from("job_type_bundle_items")
      .update({ default_quantity: quantity !== "" ? Number(quantity) : 1 })
      .eq("item_id", itemId);
    loadTemplates();
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🧰 เซตอะไหล่+ค่าแรงตามประเภทงาน</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      <button type="button" onClick={() => setShowNewModal(true)} style={{ marginBottom: 16 }}>
        + สร้างเซตใหม่
      </button>

      {error && <div className="msg error" style={{ marginBottom: 12 }}>{error}</div>}

      {loading ? (
        <div className="empty">กำลังโหลด...</div>
      ) : templates.length === 0 ? (
        <div className="empty">ยังไม่มีเซตที่สร้างไว้ — เพิ่มได้จากหน้านี้หรือจากหน้างานตอนพิมพ์ชื่อประเภทงานใหม่</div>
      ) : (
        templates.map((t) => (
          <div key={t.template_id} className="card" style={{ flexDirection: "column", alignItems: "stretch", cursor: "default" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === t.template_id ? null : t.template_id)}
                style={{ border: "none", background: "transparent", textAlign: "left", flex: 1, cursor: "pointer", fontWeight: 700, color: "var(--text)" }}
              >
                {expandedId === t.template_id ? "▼" : "▶"} {t.job_type_name} ({(t.job_type_bundle_items || []).length} รายการ)
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTemplate(t.template_id)}
                style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
              >
                🗑️ ลบเซต
              </button>
            </div>

            {expandedId === t.template_id && (
              <div style={{ marginTop: 10 }}>
                {(t.job_type_bundle_items || []).map((item) => (
                  <div key={item.item_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 6 }}>
                    <span style={{ width: 60, color: "var(--text-muted)" }}>{CATEGORY_LABELS[item.category]}</span>
                    <span style={{ flex: 1 }}>
                      {item.item_group_label} — {item.description}
                      {(item.job_type_bundle_item_variants || []).length > 0 &&
                        ` (${item.job_type_bundle_item_variants.length} sub-variant)`}
                    </span>
                    <input
                      type="number"
                      defaultValue={item.default_quantity ?? 1}
                      onBlur={(e) => handleUpdateItemQuantity(item.item_id, e.target.value)}
                      title="ปริมาณ"
                      min="0.01"
                      step="any"
                      style={{ width: 60 }}
                    />
                    <input
                      type="number"
                      defaultValue={item.default_amount ?? ""}
                      onBlur={(e) => handleUpdateItemAmount(item.item_id, e.target.value)}
                      title="ราคาต่อหน่วย"
                      style={{ width: 80 }}
                    />
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(item.item_id)}
                      style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {showNewModal && (
        <JobTypeBundleConfirmModal
          initialJobTypeName=""
          shopId={currentShopId}
          saving={savingNew}
          onCancel={() => setShowNewModal(false)}
          onSave={handleCreateOnly}
        />
      )}
    </div>
  );
}

export default function JobTypeBundlesPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "admin"]}>
      <JobTypeBundlesPageContent />
    </RequireAuth>
  );
}
