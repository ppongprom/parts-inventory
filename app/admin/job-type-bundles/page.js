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
        "template_id, job_type_name, job_type_bundle_items(item_id, category, item_group_label, description, default_amount, default_quantity, is_price_locked, sort_order, job_type_bundle_item_variants(variant_id, variant_label, description, default_amount, default_quantity, sort_order)), job_type_bundle_steps(step_id, step_name, sort_order)"
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

  async function handleCreateOnly(jobTypeName, items, steps) {
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

      if (steps && steps.length > 0) {
        const { error: stepsError } = await supabase.from("job_type_bundle_steps").insert(
          steps.map((name, i) => ({ template_id: template.template_id, step_name: name, sort_order: i }))
        );
        if (stepsError) throw stepsError;
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

  // แก้ไขรายการหลัก (ชื่อ/รายละเอียด/ปริมาณ/ราคา) — บันทึกทันทีตอนออกจากช่อง (onBlur) เหมือนของเดิม
  async function handleUpdateItemField(itemId, patch) {
    const { error: updateError } = await supabase.from("job_type_bundle_items").update(patch).eq("item_id", itemId);
    if (updateError) setError(updateError.message);
    else loadTemplates();
  }

  // เพิ่มรายการใหม่เข้าเซตที่มีอยู่แล้ว — เดิมทำได้แค่ตอนสร้างเซตใหม่ทั้งดวงผ่าน modal เท่านั้น
  async function handleAddItem(template) {
    const nextSort = (template.job_type_bundle_items || []).length;
    const { error: insertError } = await supabase.from("job_type_bundle_items").insert({
      template_id: template.template_id,
      category: "parts",
      item_group_label: "รายการใหม่",
      description: "รายละเอียดใหม่",
      default_quantity: 1,
      is_price_locked: true,
      sort_order: nextSort,
    });
    if (insertError) setError(insertError.message);
    else loadTemplates();
  }

  // แก้ไข sub-variant — เดิมหน้านี้แสดงแค่ "(N sub-variant)" เป็นข้อความ แก้ไขอะไรไม่ได้เลย
  async function handleUpdateVariantField(variantId, patch) {
    const { error: updateError } = await supabase.from("job_type_bundle_item_variants").update(patch).eq("variant_id", variantId);
    if (updateError) setError(updateError.message);
    else loadTemplates();
  }

  async function handleAddVariant(item) {
    const nextSort = (item.job_type_bundle_item_variants || []).length;
    const { error: insertError } = await supabase.from("job_type_bundle_item_variants").insert({
      item_id: item.item_id,
      variant_label: "ตัวเลือกใหม่",
      description: "รายละเอียดใหม่",
      default_quantity: 1,
      sort_order: nextSort,
    });
    if (insertError) setError(insertError.message);
    else loadTemplates();
  }

  async function handleDeleteVariant(variantId) {
    const { error: deleteError } = await supabase.from("job_type_bundle_item_variants").delete().eq("variant_id", variantId);
    if (deleteError) setError(deleteError.message);
    else loadTemplates();
  }

  // preset ขั้นตอนการทำงาน — ไม่มี assigned_to เลย (ตัดสินใจแล้ว) แก้ไข/เพิ่ม/ลบได้ตรงๆ ในหน้านี้
  async function handleUpdateStepField(stepId, patch) {
    const { error: updateError } = await supabase.from("job_type_bundle_steps").update(patch).eq("step_id", stepId);
    if (updateError) setError(updateError.message);
    else loadTemplates();
  }

  async function handleAddStep(template) {
    const nextSort = (template.job_type_bundle_steps || []).length;
    const { error: insertError } = await supabase.from("job_type_bundle_steps").insert({
      template_id: template.template_id,
      step_name: "ขั้นตอนใหม่",
      sort_order: nextSort,
    });
    if (insertError) setError(insertError.message);
    else loadTemplates();
  }

  async function handleDeleteStep(stepId) {
    const { error: deleteError } = await supabase.from("job_type_bundle_steps").delete().eq("step_id", stepId);
    if (deleteError) setError(deleteError.message);
    else loadTemplates();
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
                {(t.job_type_bundle_items || []).map((item) => {
                  const variants = item.job_type_bundle_item_variants || [];
                  const hasVariants = variants.length > 0;
                  return (
                    <div
                      key={item.item_id}
                      style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 8 }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flexWrap: "wrap" }}>
                        <select
                          value={item.category}
                          onChange={(e) => handleUpdateItemField(item.item_id, { category: e.target.value })}
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
                          defaultValue={item.item_group_label}
                          onBlur={(e) => handleUpdateItemField(item.item_id, { item_group_label: e.target.value })}
                          placeholder="ชื่อรายการ"
                          style={{ width: 140 }}
                        />
                        {/* ราคา/รายละเอียด default ของรายการหลัก ไม่ถูกใช้อีกต่อไปตอนมี sub-variant
                            แล้ว (ดู handleApplyBundle ใน app/jobs/[id]/page.js — เลือกจาก variant
                            เสมอถ้ามี) ซ่อนไปเลยกันสับสนว่าทำไมกรอกราคาไว้แล้วไม่ถูกใช้ */}
                        {!hasVariants && (
                          <>
                            <input
                              type="text"
                              defaultValue={item.description}
                              onBlur={(e) => handleUpdateItemField(item.item_id, { description: e.target.value })}
                              placeholder="รายละเอียด"
                              style={{ flex: 1, minWidth: 120 }}
                            />
                            <input
                              type="number"
                              defaultValue={item.default_quantity ?? 1}
                              onBlur={(e) =>
                                handleUpdateItemField(item.item_id, {
                                  default_quantity: e.target.value !== "" ? Number(e.target.value) : 1,
                                })
                              }
                              title="ปริมาณ"
                              min="0.01"
                              step="any"
                              style={{ width: 60 }}
                            />
                            <input
                              type="number"
                              defaultValue={item.default_amount ?? ""}
                              onBlur={(e) =>
                                handleUpdateItemField(item.item_id, {
                                  default_amount: e.target.value !== "" ? Number(e.target.value) : null,
                                })
                              }
                              title="ราคาต่อหน่วย"
                              style={{ width: 80 }}
                            />
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.item_id)}
                          style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
                        >
                          ✕
                        </button>
                      </div>

                      {hasVariants && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, marginLeft: 4 }}>
                          มี sub-variant แล้ว ({variants.length} ตัว) — ใช้รายละเอียด/ราคาจาก sub-variant ด้านล่างตอนนำไปใช้งานแทน ไม่ใช้ค่า default ของรายการหลัก
                        </div>
                      )}

                      {variants.map((variant) => (
                        <div
                          key={variant.variant_id}
                          style={{ display: "flex", gap: 6, marginTop: 6, marginLeft: 16, flexWrap: "wrap", alignItems: "center" }}
                        >
                          <input
                            type="text"
                            defaultValue={variant.variant_label}
                            onBlur={(e) => handleUpdateVariantField(variant.variant_id, { variant_label: e.target.value })}
                            placeholder="ชื่อ sub-variant"
                            style={{ width: 100 }}
                          />
                          <input
                            type="text"
                            defaultValue={variant.description}
                            onBlur={(e) => handleUpdateVariantField(variant.variant_id, { description: e.target.value })}
                            placeholder="รายละเอียด"
                            style={{ flex: 1, minWidth: 100 }}
                          />
                          <input
                            type="number"
                            defaultValue={variant.default_quantity ?? 1}
                            onBlur={(e) =>
                              handleUpdateVariantField(variant.variant_id, {
                                default_quantity: e.target.value !== "" ? Number(e.target.value) : 1,
                              })
                            }
                            title="ปริมาณ"
                            min="0.01"
                            step="any"
                            style={{ width: 60 }}
                          />
                          <input
                            type="number"
                            defaultValue={variant.default_amount ?? ""}
                            onBlur={(e) =>
                              handleUpdateVariantField(variant.variant_id, {
                                default_amount: e.target.value !== "" ? Number(e.target.value) : null,
                              })
                            }
                            title="ราคา"
                            style={{ width: 80 }}
                          />
                          <button
                            type="button"
                            onClick={() => handleDeleteVariant(variant.variant_id)}
                            style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() => handleAddVariant(item)}
                        style={{ marginTop: 6, marginLeft: 16, fontSize: 12, border: "none", background: "transparent", color: "#2563eb", cursor: "pointer" }}
                      >
                        + เพิ่ม sub-variant
                      </button>
                    </div>
                  );
                })}

                <button type="button" onClick={() => handleAddItem(t)} style={{ marginTop: 4, fontSize: 13 }}>
                  + เพิ่มรายการ
                </button>

                <div style={{ marginTop: 16, fontWeight: 600, fontSize: 13 }}>📝 ขั้นตอนการทำงาน (preset)</div>
                {(t.job_type_bundle_steps || [])
                  .slice()
                  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                  .map((step) => (
                    <div key={step.step_id} style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <input
                        type="text"
                        defaultValue={step.step_name}
                        onBlur={(e) => handleUpdateStepField(step.step_id, { step_name: e.target.value })}
                        placeholder="ชื่อขั้นตอน"
                        style={{ flex: 1, fontSize: 13 }}
                      />
                      <button
                        type="button"
                        onClick={() => handleDeleteStep(step.step_id)}
                        style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer" }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                <button
                  type="button"
                  onClick={() => handleAddStep(t)}
                  style={{ marginTop: 6, fontSize: 12, border: "none", background: "transparent", color: "#2563eb", cursor: "pointer" }}
                >
                  + เพิ่มขั้นตอน
                </button>
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
