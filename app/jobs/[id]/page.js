"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import { JOB_STATUSES, JOB_STATUS_STYLE, JOB_SOURCE_TYPES } from "../../../lib/jobStatusLabels";
import CarDamageDiagram from "../../../components/CarDamageDiagram";
import CarAutocomplete from "../../../components/CarAutocomplete";
import JobTypeBundleConfirmModal from "../../../components/JobTypeBundleConfirmModal";

const ROLE_LABELS = {
  owner: "เจ้าของ",
  manager: "ผู้จัดการ",
  supervisor: "หัวหน้างาน",
  technician: "ช่าง",
  assistant: "ผู้ช่วยช่าง",
};

const CATEGORY_LABELS = { labor: "ค่าแรง", parts: "ค่าอะไหล่", other: "อื่นๆ" };

const DOC_TYPE_LABELS = {
  receipt: "ใบรับรถ",
  quotation: "ใบเสนอราคา",
  billing: "ใบแจ้งหนี้",
};

function JobDetailPageContent() {
  const params = useParams();
  const router = useRouter();
  const { currentShopId, currentRole, user } = useAuth();
  const jobId = params.id;

  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState(null);
  const [members, setMembers] = useState([]);
  const [costItems, setCostItems] = useState([]);
  const [newCostItem, setNewCostItem] = useState({ category: "parts", description: "", amount: "", quantity: "1" });
  const [consumableQuery, setConsumableQuery] = useState("");
  const [consumableResults, setConsumableResults] = useState([]);
  const [selectedConsumablePart, setSelectedConsumablePart] = useState(null);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyResults, setHistoryResults] = useState([]);
  const [bundleQuery, setBundleQuery] = useState("");
  const [bundleResults, setBundleResults] = useState([]);
  const [selectedBundleTemplate, setSelectedBundleTemplate] = useState(null);
  const [bundleVariantChoices, setBundleVariantChoices] = useState({}); // { [item_id]: variant_id }
  const [showNewBundleModal, setShowNewBundleModal] = useState(false);
  const [savingBundle, setSavingBundle] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [customerShareUrl, setCustomerShareUrl] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creatingDoc, setCreatingDoc] = useState(null);
  const [msg, setMsg] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [selectedGeneration, setSelectedGeneration] = useState(null);
  const touchStartXRef = useRef(null);

  const [groups, setGroups] = useState([]);
  const [jobGroupIds, setJobGroupIds] = useState([]);
  const [workflowSteps, setWorkflowSteps] = useState([]);
  const [linkedParts, setLinkedParts] = useState([]);
  const [newStepName, setNewStepName] = useState("");
  const [newStepAssignee, setNewStepAssignee] = useState("");

  useEffect(() => {
    if (currentShopId) {
      fetchJob();
      fetchMembers();
      fetchCostItems();
      fetchDocuments();
      fetchGroups();
      fetchJobGroups();
      fetchWorkflowSteps();
      fetchLinkedParts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId, jobId]);

  useEffect(() => {
    if (lightboxIndex === null || !job?.photo_urls?.length) return;

    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") {
        setLightboxIndex((i) => (i - 1 + job.photo_urls.length) % job.photo_urls.length);
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((i) => (i + 1) % job.photo_urls.length);
      } else if (e.key === "Escape") {
        setLightboxIndex(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, job?.photo_urls?.length]);

  async function fetchLinkedParts() {
    const { data } = await supabase
      .from("parts")
      .select("id, part_name, price, status, item_type, quantity")
      .eq("job_id", jobId)
      .eq("item_type", "salvage");

    const parts = data || [];

    if (parts.length > 0) {
      const { data: salesData } = await supabase
        .from("part_sales")
        .select("part_id, quantity_sold, sale_price")
        .in(
          "part_id",
          parts.map((p) => p.id)
        );

      const salesByPart = {};
      (salesData || []).forEach((s) => {
        const key = s.part_id;
        if (!salesByPart[key]) salesByPart[key] = { qty: 0, total: 0 };
        salesByPart[key].qty += Number(s.quantity_sold);
        salesByPart[key].total += Number(s.quantity_sold) * Number(s.sale_price);
      });

      parts.forEach((p) => {
        p.sold_quantity = salesByPart[p.id]?.qty || 0;
        p.sold_total = salesByPart[p.id]?.total || 0;
      });
    }

    setLinkedParts(parts);
  }

  async function fetchGroups() {
    const { data } = await supabase
      .from("visibility_groups")
      .select("group_id, name")
      .eq("shop_id", currentShopId);
    setGroups(data || []);
  }

  async function fetchWorkflowSteps() {
    const { data } = await supabase
      .from("job_workflow_steps")
      .select("*")
      .eq("job_id", jobId)
      .order("step_order", { ascending: true });
    setWorkflowSteps(data || []);
  }

  async function handleAddStep() {
    if (!newStepName.trim()) return;

    const maxOrder = workflowSteps.reduce((max, s) => Math.max(max, s.step_order || 0), 0);
    const { error } = await supabase.from("job_workflow_steps").insert({
      job_id: jobId,
      shop_id: currentShopId,
      step_order: maxOrder + 1,
      step_name: newStepName.trim(),
      assigned_to: newStepAssignee || null,
    });

    if (error) {
      setMsg({ type: "error", text: "เพิ่มขั้นตอนไม่สำเร็จ: " + error.message });
    } else {
      setNewStepName("");
      setNewStepAssignee("");
      fetchWorkflowSteps();
    }
  }

  async function handleStepStatusChange(stepId, newStatus) {
    const { error } = await supabase
      .from("job_workflow_steps")
      .update({ status: newStatus })
      .eq("step_id", stepId);
    if (error) {
      setMsg({ type: "error", text: "อัปเดตสถานะไม่สำเร็จ: " + error.message });
    } else {
      fetchWorkflowSteps();
    }
  }

  async function handleStepAssigneeChange(stepId, userId) {
    await supabase.from("job_workflow_steps").update({ assigned_to: userId || null }).eq("step_id", stepId);
    fetchWorkflowSteps();
  }

  async function handleDeleteStep(stepId) {
    await supabase.from("job_workflow_steps").delete().eq("step_id", stepId);
    fetchWorkflowSteps();
  }

  async function handleMoveStep(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= workflowSteps.length) return;

    const a = workflowSteps[index];
    const b = workflowSteps[targetIndex];

    await Promise.all([
      supabase.from("job_workflow_steps").update({ step_order: b.step_order }).eq("step_id", a.step_id),
      supabase.from("job_workflow_steps").update({ step_order: a.step_order }).eq("step_id", b.step_id),
    ]);
    fetchWorkflowSteps();
  }

  async function fetchJobGroups() {
    const { data } = await supabase
      .from("job_visibility_groups")
      .select("group_id")
      .eq("job_id", jobId);
    setJobGroupIds((data || []).map((r) => r.group_id));
  }

  async function toggleJobGroup(groupId) {
    const isSelected = jobGroupIds.includes(groupId);

    if (isSelected) {
      await supabase.from("job_visibility_groups").delete().eq("job_id", jobId).eq("group_id", groupId);
    } else {
      await supabase.from("job_visibility_groups").insert({ job_id: jobId, group_id: groupId });
    }
    fetchJobGroups();
  }

  function memberLabel(m) {
    return m.contact_name || m.login_username || ROLE_LABELS[m.role] || m.user_id?.slice(0, 8);
  }

  async function fetchCostItems() {
    const { data } = await supabase
      .from("job_cost_items")
      .select("*")
      .eq("job_id", jobId)
      .order("sort_order", { ascending: true });
    setCostItems(data || []);
  }

  async function fetchDocuments() {
    const { data } = await supabase
      .from("job_documents")
      .select("document_id, doc_type, doc_number, created_at")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false });
    setDocuments(data || []);
  }

  async function searchConsumables(query) {
    setConsumableQuery(query);
    if (!query.trim()) {
      setConsumableResults([]);
      return;
    }
    // ค้นทั้งของสิ้นเปลือง (consumable) และอะไหล่ถอด (salvage) ที่ยังมีในสต็อก —
    // เลือกแล้วตัดสต็อกอัตโนมัติเหมือนกันทั้งคู่ผ่าน deduct_part_stock RPC ตัวเดียวกัน
    const { data } = await supabase
      .from("parts")
      .select("id, part_name, price, quantity, item_type")
      .eq("shop_id", currentShopId)
      .in("item_type", ["consumable", "salvage"])
      .eq("is_active", true)
      .gt("quantity", 0)
      .ilike("part_name", `%${query.trim()}%`)
      .limit(8);
    setConsumableResults(data || []);
  }

  // ค้นหารายการค่าใช้จ่ายเก่าที่เคยพิมพ์ไว้ในร้านนี้ (ค่าแรง/ค่าอะไหล่/อื่นๆ) มาหยิบใช้ซ้ำ
  // คนละอันกับค้นจากสต็อก — ไม่ตัดสต็อก ไม่ auto-fill ราคา/จำนวน เว้นให้กรอกเองเสมอ
  async function searchHistory(query) {
    setHistoryQuery(query);
    if (!query.trim()) {
      setHistoryResults([]);
      return;
    }
    const { data } = await supabase.rpc("search_cost_item_history", {
      p_shop_id: currentShopId,
      p_query: query.trim(),
    });
    setHistoryResults(data || []);
  }

  // ช่องค้นหารวมเดียว (bundle/สต็อก/ประวัติ) แชร์ query text เดียวกันผ่าน newCostItem.description
  // เลือกผลลัพธ์แบบไหนก็ต้องปิด dropdown ของทั้ง 3 แหล่งพร้อมกัน ไม่ใช่แค่แหล่งที่เลือก
  function clearSearchState() {
    setBundleQuery("");
    setBundleResults([]);
    setConsumableQuery("");
    setConsumableResults([]);
    setHistoryQuery("");
    setHistoryResults([]);
  }

  function handleSelectHistoryItem(item) {
    setSelectedConsumablePart(null); // มาจากประวัติ ไม่ผูกกับสต็อก ไม่ตัดสต็อก
    setNewCostItem((f) => ({
      ...f,
      category: item.category,
      description: item.description,
      _categoryTouched: true,
      // ตั้งใจไม่แตะ amount/quantity — เว้นให้กรอกเองเหมือนเดิมตามที่ตกลงกันไว้
    }));
    clearSearchState();
  }

  // การ์ด "Job Type Bundle Template" — ค้นหาเซตตามชื่อประเภทงาน (พิมพ์ = filter จาก preset ที่มี
  // อยู่จริงเท่านั้น — ไม่มีทาง "ใช้คำที่พิมพ์" ตรงๆ ตามที่การ์ดกำหนดไว้สำหรับ Technician)
  async function searchBundles(query) {
    setBundleQuery(query);
    setSelectedBundleTemplate(null);
    setBundleVariantChoices({});
    if (!query.trim()) {
      setBundleResults([]);
      return;
    }
    const { data } = await supabase
      .from("job_type_bundle_templates")
      .select(
        "template_id, job_type_name, job_type_bundle_items(item_id, category, item_group_label, description, default_amount, default_quantity, is_price_locked, part_id, sort_order, job_type_bundle_item_variants(variant_id, variant_label, description, default_amount, default_quantity, part_id, sort_order)), job_type_bundle_steps(step_id, step_name, sort_order)"
      )
      .eq("shop_id", currentShopId)
      .ilike("job_type_name", `%${query.trim()}%`)
      .limit(8);
    setBundleResults(data || []);
  }

  function handleSelectBundleResult(template) {
    setSelectedBundleTemplate(template);
    const defaults = {};
    (template.job_type_bundle_items || []).forEach((item) => {
      const variants = item.job_type_bundle_item_variants || [];
      if (variants.length > 0) {
        defaults[item.item_id] = variants[0].variant_id;
      }
    });
    setBundleVariantChoices(defaults);
    clearSearchState();
    setNewCostItem((f) => ({ ...f, description: "" })); // เลือกเซตแล้ว เคลียร์ query ทิ้ง ไม่ใช่ค่ารายละเอียดจริง
  }

  // นำเซตที่เลือก (จากค้นหา หรือเพิ่งสร้างใหม่) ไปใส่เป็น job_cost_items หลายแถวพร้อมกัน
  // row.amount ที่รับเข้ามาคือ "ราคาต่อหน่วย" (unit price — ตรงกับที่ trigger price-memory จำไว้
  // จาก amount/quantity เดิม) ต้องคูณด้วย quantity เองตรงนี้เพื่อได้ job_cost_items.amount ที่เป็น
  // ยอดรวมต่อแถว (ตรงกับ semantics เดิมของฟอร์มเพิ่มรายการด้วยมือที่มีช่อง "จำนวน" + "บาท (รวม)" แยกกัน)
  async function applyBundleItems(items) {
    const maxSort = costItems.reduce((max, c) => Math.max(max, c.sort_order || 0), 0);
    const rows = items.map((row, i) => {
      const quantity = row.quantity != null && row.quantity !== "" ? Number(row.quantity) : 1;
      const unitAmount = row.amount != null && row.amount !== "" ? Number(row.amount) : 0;
      return {
        job_id: jobId,
        category: row.category,
        description: row.description,
        amount: unitAmount * quantity,
        quantity,
        part_id: row.part_id || null,
        bundle_item_id: row.bundle_item_id || null,
        bundle_variant_id: row.bundle_variant_id || null,
        sort_order: maxSort + i + 1,
      };
    });
    const { error } = await supabase.from("job_cost_items").insert(rows);
    if (error) {
      setMsg({ type: "error", text: "ใส่เซตไม่สำเร็จ: " + error.message });
    } else {
      fetchCostItems();
    }
  }

  // ใส่ preset ขั้นตอนการทำงานของเซต ต่อท้ายขั้นตอนที่มีอยู่แล้วในงานนี้ (ไม่ลบ/ทับของเดิม) —
  // ตั้งใจ assigned_to เป็น null เสมอ ไม่ผูกคนรับผิดชอบมาจากเซต (ตัดสินใจแล้ว)
  async function applyBundleSteps(stepNames) {
    if (!stepNames || stepNames.length === 0) return;
    const maxOrder = workflowSteps.reduce((max, s) => Math.max(max, s.step_order || 0), -1);
    const rows = stepNames.map((name, i) => ({
      job_id: jobId,
      shop_id: currentShopId,
      step_order: maxOrder + i + 1,
      step_name: name,
      assigned_to: null,
    }));
    const { error } = await supabase.from("job_workflow_steps").insert(rows);
    if (error) {
      setMsg({ type: "error", text: "เพิ่มขั้นตอนจากเซตไม่สำเร็จ: " + error.message });
    } else {
      fetchWorkflowSteps();
    }
  }

  function handleApplyBundle() {
    const items = selectedBundleTemplate?.job_type_bundle_items || [];
    const rows = items.map((item) => {
      const variants = item.job_type_bundle_item_variants || [];
      if (variants.length > 0) {
        const chosen = variants.find((v) => v.variant_id === bundleVariantChoices[item.item_id]) || variants[0];
        return {
          category: item.category,
          description: chosen.description,
          amount: chosen.default_amount,
          quantity: chosen.default_quantity,
          part_id: chosen.part_id,
          bundle_variant_id: chosen.variant_id,
        };
      }
      return {
        category: item.category,
        description: item.description,
        amount: item.default_amount,
        quantity: item.default_quantity,
        part_id: item.part_id || null,
        bundle_item_id: item.item_id,
      };
    });
    applyBundleItems(rows);
    const stepNames = [...(selectedBundleTemplate?.job_type_bundle_steps || [])]
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
      .map((s) => s.step_name);
    applyBundleSteps(stepNames);
    setSelectedBundleTemplate(null);
    setBundleVariantChoices({});
  }

  // Owner/Manager/Admin เท่านั้นที่เห็นปุ่มนี้ (การ์ด) — สร้างเซตใหม่ inline จากหน้างานเลย ไม่ต้อง
  // ไปหน้าตั้งค่าแยก แล้วนำมาใช้กับงานปัจจุบันทันที
  async function handleCreateAndApplyBundle(jobTypeName, items, steps) {
    setSavingBundle(true);
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
        .select("item_id, category, description, default_amount, default_quantity, part_id");
      if (itemsError) throw itemsError;

      const variantRows = [];
      items.forEach((item, i) => {
        const insertedItemId = insertedItems[i].item_id;
        (item.variants || [])
          .filter((v) => v.variant_label.trim() && v.description.trim())
          .forEach((v, vi) => {
            variantRows.push({
              item_id: insertedItemId,
              variant_label: v.variant_label.trim(),
              description: v.description.trim(),
              default_amount: v.default_amount !== "" ? Number(v.default_amount) : null,
              default_quantity: v.default_quantity !== "" ? Number(v.default_quantity) : 1,
              part_id: v.part_id || null,
              sort_order: vi,
            });
          });
      });
      let insertedVariants = [];
      if (variantRows.length > 0) {
        const { data, error: variantsError } = await supabase
          .from("job_type_bundle_item_variants")
          .insert(variantRows)
          .select("item_id, description, default_amount, default_quantity, part_id");
        if (variantsError) throw variantsError;
        insertedVariants = data || [];
      }

      // ใส่เข้างานปัจจุบันทันที — ถ้ารายการไหนมี sub-variant ใช้ตัวแรกที่กรอกไว้เป็นค่าเริ่มต้น
      // (ปรับ/เลือกตัวอื่นทีหลังได้ผ่านการค้นหาเซตนี้ซ้ำในงานถัดไป)
      const rows = insertedItems.map((item) => {
        const firstVariant = insertedVariants.find((v) => v.item_id === item.item_id);
        if (firstVariant) {
          return {
            category: item.category,
            description: firstVariant.description,
            amount: firstVariant.default_amount,
            quantity: firstVariant.default_quantity,
            part_id: firstVariant.part_id,
          };
        }
        return {
          category: item.category,
          description: item.description,
          amount: item.default_amount,
          quantity: item.default_quantity,
          part_id: item.part_id || null,
          bundle_item_id: item.item_id,
        };
      });
      await applyBundleItems(rows);

      if (steps && steps.length > 0) {
        const stepsToInsert = steps.map((name, i) => ({
          template_id: template.template_id,
          step_name: name,
          sort_order: i,
        }));
        const { error: stepsError } = await supabase.from("job_type_bundle_steps").insert(stepsToInsert);
        if (stepsError) throw stepsError;
        await applyBundleSteps(steps);
      }

      setShowNewBundleModal(false);
      clearSearchState();
      setNewCostItem((f) => ({ ...f, description: "" }));
    } catch (err) {
      setMsg({ type: "error", text: "สร้างเซตไม่สำเร็จ: " + err.message });
    } finally {
      setSavingBundle(false);
    }
  }

  function handleSelectConsumable(part) {
    setSelectedConsumablePart(part);
    setNewCostItem((f) => ({
      ...f,
      category: "parts",
      description: part.part_name,
      amount: part.price ? String(part.price) : f.amount,
      quantity: "1",
      _categoryTouched: true,
    }));
    clearSearchState();
  }

  // เพิ่มรายการแบบเร็ว — ถ้าพิมพ์ขึ้นต้นด้วย "ค่า" จะเดาเป็นค่าแรงให้อัตโนมัติ
  // (ตามธรรมเนียมที่ใช้กันมา) แต่ยังกดปุ่มเลือกหมวดเองทับได้เสมอ
  function handleDescriptionChange(value) {
    setSelectedConsumablePart(null); // พิมพ์เองแล้วไม่ผูกกับสต็อกอีกต่อไป
    setNewCostItem((f) => {
      const guessedCategory = value.trim().startsWith("ค่า") ? "labor" : f.category;
      return { ...f, description: value, category: f._categoryTouched ? f.category : guessedCategory };
    });
  }

  // ช่อง "รายละเอียด" ตอนนี้เป็นช่องค้นหารวม — พิมพ์คำเดียวยิงหาพร้อมกันทั้ง 3 แหล่ง
  // (เซตงาน/สต็อก/ประวัติ) แทนที่จะต้องมี 3 กล่องแยกเหมือนเดิม
  function handleUnifiedSearch(value) {
    handleDescriptionChange(value);
    searchBundles(value);
    searchConsumables(value);
    searchHistory(value);
  }

  async function handleAddCostItem() {
    if (!newCostItem.description.trim() || !newCostItem.amount) return;

    const qty = Number(newCostItem.quantity) || 1;
    const maxSort = costItems.reduce((max, c) => Math.max(max, c.sort_order || 0), 0);

    // ถ้าเลือกของจากสต็อกไว้ ตัดสต็อกก่อน (กันเผื่อสต็อกไม่พอ ค่อยเพิ่มรายการ)
    if (selectedConsumablePart) {
      const { error: deductError } = await supabase.rpc("deduct_part_stock", {
        p_part_id: selectedConsumablePart.id,
        p_quantity: qty,
      });
      if (deductError) {
        setMsg({ type: "error", text: "ตัดสต็อกไม่สำเร็จ: " + deductError.message });
        return;
      }
    }

    const { error } = await supabase.from("job_cost_items").insert({
      job_id: jobId,
      category: newCostItem.category,
      description: newCostItem.description.trim(),
      amount: Number(newCostItem.amount),
      quantity: qty,
      part_id: selectedConsumablePart?.id || null,
      sort_order: maxSort + 1,
    });

    if (error) {
      setMsg({ type: "error", text: "เพิ่มรายการไม่สำเร็จ: " + error.message });
    } else {
      setNewCostItem({ category: "parts", description: "", amount: "", quantity: "1", _categoryTouched: false });
      setSelectedConsumablePart(null);
      fetchCostItems();
    }
  }

  async function handleDeleteCostItem(itemId) {
    // ถ้ารายการนี้เคยตัดสต็อกไว้ (ผูก part_id) ให้คืนสต็อกกลับก่อนลบ
    const item = costItems.find((c) => c.item_id === itemId);
    if (item?.part_id) {
      await supabase.rpc("deduct_part_stock", {
        p_part_id: item.part_id,
        p_quantity: -Number(item.quantity || 1), // ค่าติดลบ = บวกกลับคืน
      });
    }
    await supabase.from("job_cost_items").delete().eq("item_id", itemId);
    fetchCostItems();
  }

  async function handleMoveItem(index, direction) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= costItems.length) return;

    const a = costItems[index];
    const b = costItems[targetIndex];

    await Promise.all([
      supabase.from("job_cost_items").update({ sort_order: b.sort_order }).eq("item_id", a.item_id),
      supabase.from("job_cost_items").update({ sort_order: a.sort_order }).eq("item_id", b.item_id),
    ]);
    fetchCostItems();
  }

  const laborTotal = costItems
    .filter((c) => c.category === "labor")
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const partsTotal = costItems
    .filter((c) => c.category !== "labor")
    .reduce((sum, c) => sum + Number(c.amount || 0), 0);
  const subtotal = laborTotal + partsTotal;
  const vatAmount = job?.vat_type === "vat7" ? subtotal * 0.07 : 0;
  const grandTotal = subtotal + vatAmount;

  async function handleVatChange(e) {
    const vatType = e.target.value;
    setJob((j) => ({ ...j, vat_type: vatType }));
    await supabase.from("jobs").update({ vat_type: vatType }).eq("job_id", jobId);
  }

  async function handleCreateDocument(docType) {
    setCreatingDoc(docType);
    setMsg(null);

    try {
      const { data: docNumberData, error: docNumberError } = await supabase.rpc("generate_doc_number");
      if (docNumberError) throw docNumberError;

      const { data: shopInfo } = await supabase
        .from("shops")
        .select("shop_name, company_name, address, tax_id, phone")
        .eq("shop_id", currentShopId)
        .single();

      const { data: currentMember } = await supabase
        .from("shop_members")
        .select("contact_name, login_username")
        .eq("shop_id", currentShopId)
        .eq("user_id", user?.id)
        .maybeSingle();
      const receivedByName =
        currentMember?.contact_name || currentMember?.login_username || user?.email || "พนักงาน";

      const snapshot = {
        // ชื่อบริษัทสำหรับพิมพ์บนเอกสาร — ถ้าไม่ได้ตั้งค่าไว้ fallback ไปใช้ชื่ออู่แทน
        shop_name: shopInfo?.company_name || shopInfo?.shop_name || null,
        shop_address: shopInfo?.address || null,
        shop_tax_id: shopInfo?.tax_id || null,
        shop_phone: shopInfo?.phone || null,
        received_by_name: receivedByName,
        customer_name: job.customer_name,
        customer_phone: job.customer_phone,
        customer_address: job.customer_address,
        car_brand: job.car_brand,
        car_model: job.car_model,
        car_year_display: job.car_year_display,
        license_plate: job.license_plate,
        vin: job.vin || null,
        cost_items: costItems.map((c) => ({
          category: c.category,
          description: c.description,
          amount: Number(c.amount),
          quantity: Number(c.quantity) || 1,
        })),
        labor_total: laborTotal,
        parts_total: partsTotal,
        subtotal,
        vat_type: job.vat_type,
        vat_amount: vatAmount,
        grand_total: grandTotal,
        damage_points: job.damage_points || [],
        car_diagram_type: job.car_diagram_type || "sedan",
        notes: job.notes,
      };

      const { data, error } = await supabase
        .from("job_documents")
        .insert({
          shop_id: currentShopId,
          job_id: jobId,
          doc_type: docType,
          doc_number: docNumberData,
          snapshot,
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (error) throw error;

      fetchDocuments();
      window.open(`/jobs/${jobId}/documents/${data.document_id}`, "_blank");
    } catch (err) {
      setMsg({ type: "error", text: "สร้างเอกสารไม่สำเร็จ: " + err.message });
    } finally {
      setCreatingDoc(null);
    }
  }

  async function handleCopyCustomerLink() {
    if (!job?.customer_id) {
      setMsg({ type: "error", text: "งานนี้ยังไม่มีเบอร์โทรลูกค้า ไม่สามารถสร้างลิงก์ได้" });
      return;
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("share_token")
      .eq("customer_id", job.customer_id)
      .maybeSingle();

    if (!customer) return;

    const url = `${window.location.origin}/share/customer/${customer.share_token}`;
    setCustomerShareUrl(url);
    navigator.clipboard?.writeText(url);
    setMsg({ type: "success", text: "คัดลอกลิงก์แล้ว ✅ (ส่งให้ลูกค้าได้เลย)" });
  }

  async function fetchJob() {
    setLoading(true);
    const { data, error } = await supabase.from("jobs").select("*").eq("job_id", jobId).single();
    if (error) {
      setMsg({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ: " + error.message });
    } else {
      setJob(data);
      if (data.car_year_display) {
        let trimName = null;
        if (data.trim_id) {
          const { data: trimRow } = await supabase
            .from("model_trims")
            .select("trim_name")
            .eq("trim_id", data.trim_id)
            .maybeSingle();
          trimName = trimRow?.trim_name || null;
        }
        let generationCode = null;
        if (data.generation_id) {
          const { data: genRow } = await supabase
            .from("model_generations")
            .select("generation_code")
            .eq("generation_id", data.generation_id)
            .maybeSingle();
          generationCode = genRow?.generation_code || null;
        }
        setSelectedGeneration({
          generation_id: data.generation_id,
          year_range_display: data.car_year_display,
          generation_code: generationCode,
          trim_id: data.trim_id || null,
          trim_name: trimName,
        });
      }
    }
    setLoading(false);
  }

  async function fetchMembers() {
    const { data } = await supabase
      .from("shop_members")
      .select("user_id, role, contact_name, login_username")
      .eq("shop_id", currentShopId)
      .eq("status", "active")
      .in("role", ["supervisor", "technician", "assistant", "manager", "owner"]);
    setMembers(data || []);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setJob((j) => ({ ...j, [name]: value }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const { error } = await supabase
      .from("jobs")
      .update({
        customer_name: job.customer_name,
        customer_phone: job.customer_phone,
        customer_address: job.customer_address,
        car_brand: job.car_brand,
        car_model: job.car_model,
        car_year_display: selectedGeneration?.year_range_display || null,
        generation_id: selectedGeneration?.generation_id || null,
        trim_id: selectedGeneration?.trim_id || null,
        license_plate: job.license_plate,
        source_type: job.source_type,
        status: job.status,
        assigned_to: job.assigned_to || null,
        notes: job.notes,
        damage_points: job.damage_points || [],
        car_diagram_type: job.car_diagram_type || "sedan",
        vehicle_purchase_price: job.vehicle_purchase_price ? Number(job.vehicle_purchase_price) : null,
      })
      .eq("job_id", jobId);

    if (error) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + error.message });
    } else {
      setMsg({ type: "success", text: "บันทึกแล้ว ✅" });
    }
    setSaving(false);
  }

  async function handleDelete() {
    const confirmed = window.confirm(`ลบงานของ "${job.customer_name || "ลูกค้า"}" ใช่ไหม? (ย้ายไปถังขยะ กู้คืนได้ภายหลัง)`);
    if (!confirmed) return;

    setDeleting(true);
    // soft delete — ย้ายไปถังขยะแทนการลบถาวร (กู้คืน/เคลียร์ถาวรได้ที่หน้า /jobs/trash)
    const { error } = await supabase
      .from("jobs")
      .update({ deleted_at: new Date().toISOString() })
      .eq("job_id", jobId);
    if (error) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + error.message });
      setDeleting(false);
    } else {
      router.push("/jobs");
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังโหลด...</div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="container">
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <Link href="/jobs" className="nav-link secondary" style={{ marginTop: 16, display: "inline-block" }}>
          ← กลับ
        </Link>
      </div>
    );
  }

  const canDelete = currentRole === "owner" || currentRole === "manager";

  return (
    <div className="container">
      <div className="header">
        <h1>✏️ รายละเอียดงาน</h1>
        <Link href="/jobs" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {job.photo_urls?.length > 0 && (
        <>
          <div className="photo-thumb-row" style={{ marginBottom: 16 }}>
            {job.photo_urls.map((url, i) => (
              <div className="photo-thumb" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`รูป ${i + 1}`} onClick={() => setLightboxIndex(i)} />
              </div>
            ))}
          </div>

          {lightboxIndex !== null && (
            <div
              onClick={() => setLightboxIndex(null)}
              onTouchStart={(e) => {
                touchStartXRef.current = e.touches[0].clientX;
              }}
              onTouchEnd={(e) => {
                if (touchStartXRef.current === null) return;
                const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
                touchStartXRef.current = null;
                if (Math.abs(deltaX) < 40) return; // ไม่ใช่การปัด แค่แตะ
                const len = job.photo_urls.length;
                if (deltaX > 0) {
                  setLightboxIndex((i) => (i - 1 + len) % len);
                } else {
                  setLightboxIndex((i) => (i + 1) % len);
                }
              }}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.9)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 100,
                cursor: "zoom-out",
                padding: 20,
              }}
            >
              {job.photo_urls.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex((i) => (i - 1 + job.photo_urls.length) % job.photo_urls.length);
                  }}
                  aria-label="รูปก่อนหน้า"
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.15)",
                    color: "white",
                    fontSize: 22,
                    cursor: "pointer",
                    zIndex: 101,
                  }}
                >
                  ‹
                </button>
              )}

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={job.photo_urls[lightboxIndex]}
                alt="ขยายรูป"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
              />

              {job.photo_urls.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxIndex((i) => (i + 1) % job.photo_urls.length);
                  }}
                  aria-label="รูปถัดไป"
                  style={{
                    position: "absolute",
                    right: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    border: "none",
                    background: "rgba(255,255,255,0.15)",
                    color: "white",
                    fontSize: 22,
                    cursor: "pointer",
                    zIndex: 101,
                  }}
                >
                  ›
                </button>
              )}

              {job.photo_urls.length > 1 && (
                <div
                  style={{
                    position: "absolute",
                    bottom: 20,
                    left: "50%",
                    transform: "translateX(-50%)",
                    color: "white",
                    fontSize: 13,
                    background: "rgba(0,0,0,0.5)",
                    padding: "4px 12px",
                    borderRadius: 20,
                  }}
                >
                  {lightboxIndex + 1} / {job.photo_urls.length}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <form onSubmit={handleSave}>
        <label>
          สถานะงาน
          <select name="status" value={job.status} onChange={handleChange}>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {JOB_STATUS_STYLE[s].label}
              </option>
            ))}
          </select>
        </label>

        <label>
          มอบหมายให้ช่าง
          <select name="assigned_to" value={job.assigned_to || ""} onChange={handleChange}>
            <option value="">ยังไม่มอบหมาย</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)} ({ROLE_LABELS[m.role]})
              </option>
            ))}
          </select>
        </label>

        <label>
          ให้ใครเห็นงานนี้บ้าง (เลือกได้หลายกลุ่ม — ไม่เลือกเลย = ทุกคนในอู่เห็นได้)
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {groups.map((g) => {
              const isSelected = jobGroupIds.includes(g.group_id);
              return (
                <button
                  key={g.group_id}
                  type="button"
                  onClick={() => toggleJobGroup(g.group_id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 20,
                    border: "1px solid var(--border-strong)",
                    background: isSelected ? "#2563eb" : "var(--surface)",
                    color: isSelected ? "white" : "var(--text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {isSelected ? "✓ " : ""}
                  {g.name}
                </button>
              );
            })}
            {groups.length === 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                ยังไม่มีกลุ่มในอู่นี้ — ไปสร้างที่ /admin/groups ก่อน
              </span>
            )}
          </div>
        </label>

        <label>
          ชื่อลูกค้า
          <input type="text" name="customer_name" value={job.customer_name || ""} onChange={handleChange} />
        </label>

        <label>
          เบอร์โทรลูกค้า
          <input type="tel" name="customer_phone" value={job.customer_phone || ""} onChange={handleChange} />
        </label>

        <label>
          ที่อยู่ลูกค้า (จำเป็นสำหรับออกใบกำกับภาษี)
          <input type="text" name="customer_address" value={job.customer_address || ""} onChange={handleChange} />
        </label>

        <label>
          ทะเบียนรถ
          <input type="text" name="license_plate" value={job.license_plate || ""} onChange={handleChange} />
        </label>

        <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
          🔍 ค้นหารถ (ยี่ห้อ/รุ่น) — พิมพ์แล้วเลือกเฉพาะเมื่อต้องการเปลี่ยนรถของงานนี้
          <CarAutocomplete
            onSelect={(item) => {
              setJob((j) => ({
                ...j,
                car_brand: item?.brand_name || "",
                car_model: item?.model_name || "",
              }));
              setSelectedGeneration(item);
            }}
          />
        </div>

        <label>
          ยี่ห้อ รุ่น ปีผลิต ของรถ
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface-dim)",
              fontSize: 14,
            }}
          >
            {job.car_brand || job.car_model
              ? `${job.car_brand || ""} ${job.car_model || ""}${
                  selectedGeneration?.year_range_display ? ` · ${selectedGeneration.year_range_display}` : ""
                }${
                  selectedGeneration?.generation_code ? ` (${selectedGeneration.generation_code})` : ""
                }${
                  selectedGeneration?.trim_name ? ` · รุ่นย่อย: ${selectedGeneration.trim_name}` : ""
                }`.trim()
              : "— ยังไม่มีข้อมูลรถ — ค้นหาด้านบนเพื่อเลือก —"}
          </div>
        </label>

        <label>
          ที่มา
          <select name="source_type" value={job.source_type || ""} onChange={handleChange}>
            <option value="">— เลือก —</option>
            {JOB_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
          แผนภาพจุดเสียหาย
          <CarDamageDiagram
            points={job.damage_points || []}
            onChange={(pts) => setJob((j) => ({ ...j, damage_points: pts }))}
            carType={job.car_diagram_type || "sedan"}
            onCarTypeChange={(type) => setJob((j) => ({ ...j, car_diagram_type: type }))}
          />
        </div>

        <label>
          หมายเหตุ
          <input type="text" name="notes" value={job.notes || ""} onChange={handleChange} />
        </label>

        <div className="card-sub" style={{ fontSize: 12 }}>
          รับเข้าเมื่อ {new Date(job.created_at).toLocaleString("th-TH")}
          {job.updated_at && <> · แก้ไขล่าสุด {new Date(job.updated_at).toLocaleString("th-TH")}</>}
        </div>

        <button type="submit" disabled={saving}>
          {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
        </button>
      </form>

      {/* ================= Phase 3: ราคาซื้อรถ + กำไรจากอะไหล่ที่ถอด ================= */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>💵 ต้นทุน-กำไร (อะไหล่ถอดจากคันนี้)</h2>

        <label>
          ราคาซื้อรถทั้งคัน (ก่อนถอดแยกขาย)
          <input
            type="number"
            value={job.vehicle_purchase_price ?? ""}
            onChange={(e) => setJob((j) => ({ ...j, vehicle_purchase_price: e.target.value }))}
            placeholder="เช่น 300000"
          />
        </label>

        <Link
          href={`/add?job_id=${jobId}`}
          className="no-print"
          style={{
            display: "block",
            textAlign: "center",
            marginTop: 10,
            marginBottom: 12,
            padding: 10,
            borderRadius: 8,
            border: "1px dashed var(--border-strong)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          + เพิ่มอะไหล่จากงานนี้
        </Link>

        {linkedParts.length === 0 ? (
          <div className="empty" style={{ padding: 16 }}>
            ยังไม่มีอะไหล่ที่ผูกกับงานนี้
          </div>
        ) : (
          <div style={{ fontSize: 13, marginTop: 8 }}>
            {(() => {
              const soldParts = linkedParts.filter((p) => (p.sold_quantity || 0) > 0);
              const soldTotal = linkedParts.reduce((sum, p) => sum + (p.sold_total || 0), 0);
              const purchasePrice = Number(job.vehicle_purchase_price) || 0;
              const profit = soldTotal - purchasePrice;

              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ color: "var(--text-muted)" }}>อะไหล่ทั้งหมดที่ถอด</span>
                    <span>{linkedParts.length} ชิ้น</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ color: "var(--text-muted)" }}>ขายแล้ว</span>
                    <span>
                      {soldParts.length} ชิ้น · {soldTotal.toLocaleString()} บาท
                    </span>
                  </div>
                  {purchasePrice > 0 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "8px 0",
                        borderTop: "1px solid var(--border-strong)",
                        marginTop: 6,
                        fontWeight: 700,
                        color: profit >= 0 ? "var(--success-text)" : "var(--danger-text)",
                      }}
                    >
                      <span>กำไรโดยประมาณ (เทียบเฉพาะที่ขายแล้ว)</span>
                      <span>{profit.toLocaleString()} บาท</span>
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                    * เป็นตัวเลขประมาณการเทียบยอดขายสะสมกับราคาซื้อรถทั้งคัน ยังไม่รวมค่าซ่อม/ค่าแรงถอดแยก
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* ================= Phase E: ขั้นตอนการทำงาน ================= */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>📝 ขั้นตอนการทำงาน</h2>

        {workflowSteps.map((step, index) => (
          <div
            className="card"
            key={step.step_id}
            style={{ cursor: "default", alignItems: "center", flexWrap: "wrap" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => handleMoveStep(index, -1)}
                disabled={index === 0}
                style={{ border: "none", background: "transparent", color: index === 0 ? "var(--border-strong)" : "var(--text-muted)", cursor: index === 0 ? "default" : "pointer", fontSize: 14, padding: 0 }}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => handleMoveStep(index, 1)}
                disabled={index === workflowSteps.length - 1}
                style={{ border: "none", background: "transparent", color: index === workflowSteps.length - 1 ? "var(--border-strong)" : "var(--text-muted)", cursor: index === workflowSteps.length - 1 ? "default" : "pointer", fontSize: 14, padding: 0 }}
              >
                ▼
              </button>
            </div>

            <div className="card-body" style={{ flex: 1, minWidth: 140 }}>
              <div className="card-title" style={{ fontSize: 14 }}>
                {index + 1}. {step.step_name}
              </div>
              <div className="card-sub">
                {step.status === "done" && step.completed_at
                  ? `✅ เสร็จเมื่อ ${new Date(step.completed_at).toLocaleString("th-TH")}`
                  : step.status === "in_progress"
                  ? "🔧 กำลังทำ"
                  : step.status === "skipped"
                  ? "⏭️ ข้าม"
                  : "⏳ ยังไม่เริ่ม"}
              </div>
            </div>

            <select
              value={step.assigned_to || ""}
              onChange={(e) => handleStepAssigneeChange(step.step_id, e.target.value)}
              style={{ fontSize: 12, padding: 8, width: 120 }}
            >
              <option value="">ไม่มอบหมาย</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {memberLabel(m)}
                </option>
              ))}
            </select>

            <select
              value={step.status}
              onChange={(e) => handleStepStatusChange(step.step_id, e.target.value)}
              style={{ fontSize: 12, padding: 8, width: 110 }}
            >
              <option value="pending">ยังไม่เริ่ม</option>
              <option value="in_progress">กำลังทำ</option>
              <option value="done">เสร็จแล้ว</option>
              <option value="skipped">ข้าม</option>
            </select>

            <button
              type="button"
              onClick={() => handleDeleteStep(step.step_id)}
              style={{
                padding: "6px 10px",
                borderRadius: 8,
                border: "1px solid var(--danger-border)",
                background: "transparent",
                color: "var(--danger-text)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ลบ
            </button>
          </div>
        ))}

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            type="text"
            placeholder="ขั้นตอนใหม่ เช่น สั่งอะไหล่"
            value={newStepName}
            onChange={(e) => setNewStepName(e.target.value)}
            style={{ flex: 1 }}
          />
          <select
            value={newStepAssignee}
            onChange={(e) => setNewStepAssignee(e.target.value)}
            style={{ width: 130, fontSize: 12 }}
          >
            <option value="">ไม่มอบหมาย</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAddStep}
            style={{
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + เพิ่ม
          </button>
        </div>
      </div>

      {/* ================= Phase A: รายการค่าใช้จ่าย + จัดลำดับ + VAT ================= */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>💰 รายการค่าใช้จ่าย</h2>

        {costItems.map((item, index) => (
          <div
            className="card"
            key={item.item_id}
            style={{ cursor: "default", alignItems: "center", justifyContent: "space-between" }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => handleMoveItem(index, -1)}
                disabled={index === 0}
                style={{
                  border: "none",
                  background: "transparent",
                  color: index === 0 ? "var(--border-strong)" : "var(--text-muted)",
                  cursor: index === 0 ? "default" : "pointer",
                  fontSize: 14,
                  padding: 0,
                }}
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => handleMoveItem(index, 1)}
                disabled={index === costItems.length - 1}
                style={{
                  border: "none",
                  background: "transparent",
                  color: index === costItems.length - 1 ? "var(--border-strong)" : "var(--text-muted)",
                  cursor: index === costItems.length - 1 ? "default" : "pointer",
                  fontSize: 14,
                  padding: 0,
                }}
              >
                ▼
              </button>
            </div>

            <div className="card-body" style={{ flex: 1 }}>
              <div className="card-title" style={{ fontSize: 14 }}>
                {item.description}
              </div>
              <div className="card-sub">
                {CATEGORY_LABELS[item.category]} · จำนวน {item.quantity || 1} ·{" "}
                {Number(item.amount).toLocaleString()} บาท
                {Number(item.quantity) > 1 &&
                  ` (${(Number(item.amount) / Number(item.quantity)).toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}/หน่วย)`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleDeleteCostItem(item.item_id)}
              style={{
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid var(--danger-border)",
                background: "transparent",
                color: "var(--danger-text)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              ลบ
            </button>
          </div>
        ))}

        {costItems.length > 0 && (
          <div style={{ padding: "10px 0", borderTop: "1px solid var(--border-strong)", marginTop: 8, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
              <span>ค่าแรงรวม</span>
              <span>{laborTotal.toLocaleString()} บาท</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
              <span>ค่าอะไหล่รวม</span>
              <span>{partsTotal.toLocaleString()} บาท</span>
            </div>
            {job.vat_type === "vat7" && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-muted)" }}>
                <span>VAT 7%</span>
                <span>{vatAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} บาท</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: 16, marginTop: 6 }}>
              <span>รวมทั้งสิ้น</span>
              <span>{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} บาท</span>
            </div>
          </div>
        )}

        <label style={{ marginTop: 12 }}>
          VAT
          <select value={job.vat_type} onChange={handleVatChange}>
            <option value="none">Non-VAT</option>
            <option value="vat7">VAT 7%</option>
          </select>
        </label>

        {/* ฟอร์มเพิ่มรายการแบบเร็ว: ช่อง "รายละเอียด" ตอนนี้เป็นช่องค้นหารวม พิมพ์แล้วยิงหา
            พร้อมกันทั้งเซตงาน (bundle) / อะไหล่ในสต็อก / รายการที่เคยใช้ก่อนหน้า และ "ค่า..." ยังเดา
            เป็นค่าแรงอัตโนมัติเหมือนเดิม — รวม 3 กล่องเดิมเป็นกล่องเดียวเพื่อลดความรก */}
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {["labor", "parts", "other"].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setNewCostItem((f) => ({ ...f, category: cat, _categoryTouched: true }))}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border-strong)",
                  background: newCostItem.category === cat ? "#2563eb" : "var(--surface)",
                  color: newCostItem.category === cat ? "white" : "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            ))}
          </div>
          <div style={{ position: "relative", flex: 1, minWidth: 160 }}>
            <input
              type="text"
              placeholder="รายละเอียด — พิมพ์ชื่องาน/อะไหล่/รายการที่เคยใช้ ('ค่า...' = ค่าแรงอัตโนมัติ)"
              value={newCostItem.description}
              onChange={(e) => handleUnifiedSearch(e.target.value)}
              style={{ width: "100%" }}
            />
            {(bundleResults.length > 0 || consumableResults.length > 0 || historyResults.length > 0) && (
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
                  maxHeight: 280,
                  overflowY: "auto",
                }}
              >
                {bundleResults.length > 0 && (
                  <>
                    <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                      🧰 เซตงาน
                    </div>
                    {bundleResults.map((t) => (
                      <button
                        key={t.template_id}
                        type="button"
                        onClick={() => handleSelectBundleResult(t)}
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
                        🧰 {t.job_type_name} ({(t.job_type_bundle_items || []).length} รายการ)
                      </button>
                    ))}
                  </>
                )}
                {consumableResults.length > 0 && (
                  <>
                    <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                      📦 สต็อก
                    </div>
                    {consumableResults.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleSelectConsumable(p)}
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
                  </>
                )}
                {historyResults.length > 0 && (
                  <>
                    <div style={{ padding: "6px 10px", fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>
                      🕘 เคยใช้
                    </div>
                    {historyResults.map((item, i) => (
                      <button
                        key={`${item.description}-${item.category}-${i}`}
                        type="button"
                        onClick={() => handleSelectHistoryItem(item)}
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
                        {item.description}{" "}
                        <span style={{ color: "var(--text-muted)" }}>({CATEGORY_LABELS[item.category] || item.category})</span>
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
            {/* Technician ไม่มีปุ่มนี้เด็ดขาด (การ์ด) — พิมพ์แล้วไม่เจอต้องให้ Owner/Manager/Admin
                สร้างเซตใหม่แทน */}
            {bundleQuery.trim() && bundleResults.length === 0 && ["owner", "manager", "admin"].includes(currentRole) && (
              <button
                type="button"
                onClick={() => setShowNewBundleModal(true)}
                style={{ marginTop: 6, fontSize: 12 }}
              >
                + สร้างชุดใหม่ &quot;{bundleQuery.trim()}&quot;
              </button>
            )}
          </div>
          <input
            type="number"
            placeholder="จำนวน"
            value={newCostItem.quantity}
            onChange={(e) => setNewCostItem((f) => ({ ...f, quantity: e.target.value }))}
            style={{ width: 70 }}
            min="0.01"
            step="any"
          />
          <input
            type="number"
            placeholder="บาท (รวม)"
            value={newCostItem.amount}
            onChange={(e) => setNewCostItem((f) => ({ ...f, amount: e.target.value }))}
            style={{ width: 100 }}
          />
          <button
            type="button"
            onClick={handleAddCostItem}
            style={{
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + เพิ่ม
          </button>
        </div>

        {selectedBundleTemplate && (
          <div
            style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>🧰 {selectedBundleTemplate.job_type_name}</div>
            {(selectedBundleTemplate.job_type_bundle_items || []).map((item) => {
              const variants = item.job_type_bundle_item_variants || [];
              return (
                <div key={item.item_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, fontSize: 13 }}>
                  <span style={{ flex: 1 }}>
                    {CATEGORY_LABELS[item.category]}: {item.item_group_label}
                  </span>
                  {variants.length > 0 ? (
                    <select
                      value={bundleVariantChoices[item.item_id] || ""}
                      onChange={(e) =>
                        setBundleVariantChoices((prev) => ({ ...prev, [item.item_id]: Number(e.target.value) }))
                      }
                    >
                      {variants.map((v) => (
                        <option key={v.variant_id} value={v.variant_id}>
                          {v.variant_label} — × {v.default_quantity ?? 1}{" "}
                          ({v.default_amount ? `${Number(v.default_amount).toLocaleString()} บาท/หน่วย` : "ไม่มีราคา"})
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>
                      × {item.default_quantity ?? 1}{" "}
                      {item.default_amount ? `(${Number(item.default_amount).toLocaleString()} บาท/หน่วย)` : "(ไม่มีราคา)"}
                    </span>
                  )}
                </div>
              );
            })}
            {(selectedBundleTemplate.job_type_bundle_steps || []).length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                📝 จะเพิ่มขั้นตอน:{" "}
                {[...selectedBundleTemplate.job_type_bundle_steps]
                  .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                  .map((s) => s.step_name)
                  .join(", ")}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button type="button" onClick={handleApplyBundle}>
                ✅ ใช้เซตนี้
              </button>
              <button type="button" onClick={() => setSelectedBundleTemplate(null)}>
                ยกเลิก
              </button>
            </div>
          </div>
        )}

        {showNewBundleModal && (
          <JobTypeBundleConfirmModal
            initialJobTypeName={bundleQuery.trim()}
            shopId={currentShopId}
            saving={savingBundle}
            onCancel={() => setShowNewBundleModal(false)}
            onSave={handleCreateAndApplyBundle}
          />
        )}

        {selectedConsumablePart && (
          <div
            style={{
              fontSize: 12,
              color: "var(--zone-text)",
              background: "var(--zone-bg)",
              padding: 8,
              borderRadius: 8,
              marginTop: 8,
            }}
          >
            🔗 ผูกกับสต็อก: {selectedConsumablePart.part_name} — บันทึกแล้วจะตัดสต็อกอัตโนมัติ
          </div>
        )}
      </div>

      {/* ================= Phase B: เอกสาร 3 ประเภท ================= */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 10 }}>🧾 เอกสาร</h2>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            type="button"
            onClick={() => handleCreateDocument("receipt")}
            disabled={creatingDoc !== null}
            style={{
              flex: 1,
              minWidth: 100,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {creatingDoc === "receipt" ? "กำลังสร้าง..." : "📋 ใบรับรถ"}
          </button>
          <button
            type="button"
            onClick={() => handleCreateDocument("quotation")}
            disabled={creatingDoc !== null}
            style={{
              flex: 1,
              minWidth: 100,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {creatingDoc === "quotation" ? "กำลังสร้าง..." : "📄 ใบเสนอราคา"}
          </button>
          <button
            type="button"
            onClick={() => handleCreateDocument("billing")}
            disabled={creatingDoc !== null}
            style={{
              flex: 1,
              minWidth: 100,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface)",
              color: "var(--text)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {creatingDoc === "billing" ? "กำลังสร้าง..." : "🧾 ใบแจ้งหนี้"}
          </button>
        </div>

        {documents.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>เอกสารที่เคยสร้าง</div>
            {documents.map((doc) => (
              <Link
                key={doc.document_id}
                href={`/jobs/${jobId}/documents/${doc.document_id}`}
                target="_blank"
                className="card"
                style={{ textDecoration: "none", color: "inherit", padding: "10px 12px" }}
              >
                <div className="card-body" style={{ gap: 0 }}>
                  <div className="card-title" style={{ fontSize: 13 }}>
                    {DOC_TYPE_LABELS[doc.doc_type]} · {doc.doc_number}
                  </div>
                  <div className="card-sub" style={{ fontSize: 12 }}>
                    {new Date(doc.created_at).toLocaleString("th-TH")}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 24 }}>
        <button
          type="button"
          onClick={handleCopyCustomerLink}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--link)",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          🔗 คัดลอกลิงก์ให้ลูกค้าดูรายการซ่อม+ค่าใช้จ่าย
        </button>
        {customerShareUrl && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, wordBreak: "break-all" }}>
            {customerShareUrl}
          </div>
        )}
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          style={{
            marginTop: 12,
            width: "100%",
            padding: 14,
            borderRadius: 8,
            border: "1px solid var(--danger-border)",
            background: "transparent",
            color: "var(--danger-text)",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {deleting ? "กำลังลบ..." : "🗑️ ลบงานนี้"}
        </button>
      )}
    </div>
  );
}

export default function JobDetailPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <JobDetailPageContent />
    </RequireAuth>
  );
}
