"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import CarAutocomplete from "../../../components/CarAutocomplete";
import CarDamageDiagram from "../../../components/CarDamageDiagram";
import { resizeImageFile } from "../../../lib/imageResize";
import { uploadJobPhotos } from "../../../lib/storageHelpers";
import { JOB_SOURCE_TYPES } from "../../../lib/jobStatusLabels";

function NewJobPageContent() {
  const router = useRouter();
  const { currentShopId, user } = useAuth();
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  const [form, setForm] = useState({
    customer_name: "",
    customer_phone: "",
    customer_address: "",
    car_brand: "",
    car_model: "",
    license_plate: "",
    source_type: JOB_SOURCE_TYPES[0],
    notes: "",
  });
  const [selectedGeneration, setSelectedGeneration] = useState(null);
  const [damagePoints, setDamagePoints] = useState([]);
  const [carDiagramType, setCarDiagramType] = useState("sedan");
  const [photos, setPhotos] = useState([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [groups, setGroups] = useState([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState([]);
  const [members, setMembers] = useState([]);
  const [workflowSteps, setWorkflowSteps] = useState([{ step_name: "", assigned_to: "" }]);

  useEffect(() => {
    if (!currentShopId) return;
    supabase
      .from("visibility_groups")
      .select("group_id, name")
      .eq("shop_id", currentShopId)
      .then(({ data }) => setGroups(data || []));

    supabase
      .from("shop_members")
      .select("user_id, role, contact_name, login_username")
      .eq("shop_id", currentShopId)
      .eq("status", "active")
      .then(({ data }) => setMembers(data || []));
  }, [currentShopId]);

  function memberLabel(m) {
    return m.contact_name || m.login_username || m.role;
  }

  function toggleGroup(groupId) {
    setSelectedGroupIds((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]
    );
  }

  function handleStepChange(index, field, value) {
    setWorkflowSteps((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }

  function addStepRow() {
    setWorkflowSteps((prev) => [...prev, { step_name: "", assigned_to: "" }]);
  }

  function removeStepRow(index) {
    setWorkflowSteps((prev) => prev.filter((_, i) => i !== index));
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setProcessingPhoto(true);
    const resizedList = [];
    for (const file of files) {
      const resized = await resizeImageFile(file);
      resizedList.push({ file: resized, previewUrl: URL.createObjectURL(resized) });
    }
    setPhotos((prev) => [...prev, ...resizedList]);
    setProcessingPhoto(false);
    e.target.value = "";
  }

  function handleRemovePhoto(index) {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    try {
      const photoUrls = photos.length ? await uploadJobPhotos(photos.map((p) => p.file)) : [];

      // หา/สร้างลูกค้า ผูกด้วยเบอร์โทร (ถ้ามี) เพื่อให้ลูกค้าเดิมเห็นงานทุกคันในลิงก์เดียว
      let customerId = null;
      if (form.customer_phone) {
        const { data: existingCustomer } = await supabase
          .from("customers")
          .select("customer_id")
          .eq("shop_id", currentShopId)
          .eq("phone", form.customer_phone)
          .maybeSingle();

        if (existingCustomer) {
          customerId = existingCustomer.customer_id;
        } else {
          const { data: newCustomer, error: customerError } = await supabase
            .from("customers")
            .insert({
              shop_id: currentShopId,
              name: form.customer_name || null,
              phone: form.customer_phone,
              address: form.customer_address || null,
            })
            .select()
            .single();
          if (customerError) throw customerError;
          customerId = newCustomer.customer_id;
        }
      }

      const { data, error } = await supabase
        .from("jobs")
        .insert({
          shop_id: currentShopId,
          customer_id: customerId,
          customer_name: form.customer_name || null,
          customer_phone: form.customer_phone || null,
          customer_address: form.customer_address || null,
          car_brand: form.car_brand || null,
          car_model: form.car_model || null,
          car_year_display: selectedGeneration?.year_range_display || null,
          generation_id: selectedGeneration?.generation_id || null,
          trim_id: selectedGeneration?.trim_id || null,
          license_plate: form.license_plate || null,
          source_type: form.source_type || null,
          notes: form.notes || null,
          photo_urls: photoUrls,
          damage_points: damagePoints,
          car_diagram_type: carDiagramType,
          status: "received",
          created_by: user?.id || null,
        })
        .select()
        .single();

      if (error) throw error;

      // ผูกงานเข้ากับกลุ่มที่เลือก (เลือกได้หลายกลุ่ม — ไม่เลือกเลย = ทุกคนเห็น)
      if (selectedGroupIds.length > 0) {
        const { error: groupError } = await supabase.from("job_visibility_groups").insert(
          selectedGroupIds.map((groupId) => ({ job_id: data.job_id, group_id: groupId }))
        );
        if (groupError) throw groupError;
      }

      // บันทึกขั้นตอนงานคร่าวๆ ที่ระบุไว้ (ถ้ามี)
      const validSteps = workflowSteps.filter((s) => s.step_name.trim());
      if (validSteps.length > 0) {
        const { error: stepsError } = await supabase.from("job_workflow_steps").insert(
          validSteps.map((s, i) => ({
            job_id: data.job_id,
            shop_id: currentShopId,
            step_order: i,
            step_name: s.step_name.trim(),
            assigned_to: s.assigned_to || null,
          }))
        );
        if (stepsError) throw stepsError;
      }

      setMsg({ type: "success", text: "รับงานเรียบร้อยแล้ว ✅" });
      setTimeout(() => router.push(`/jobs/${data.job_id}`), 600);
    } catch (err) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + err.message });
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>+ รับงานใหม่</h1>
        <Link href="/jobs" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          รูปสภาพรถตอนรับเข้า
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              disabled={processingPhoto}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 8,
                border: "1px dashed var(--border-strong)",
                background: "var(--surface)",
                color: "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              📷 {processingPhoto ? "กำลังประมวลผล..." : "ถ่ายรูป"}
            </button>
            <button
              type="button"
              onClick={() => galleryInputRef.current?.click()}
              disabled={processingPhoto}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 8,
                border: "1px dashed var(--border-strong)",
                background: "var(--surface)",
                color: "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🖼️ เลือกจากคลังภาพ
            </button>
          </div>
        </label>

        {photos.length > 0 && (
          <div className="photo-thumb-row">
            {photos.map((p, i) => (
              <div className="photo-thumb" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.previewUrl} alt={`รูป ${i + 1}`} />
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={() => handleRemovePhoto(i)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <label>
          ชื่อลูกค้า
          <input
            type="text"
            name="customer_name"
            value={form.customer_name}
            onChange={handleChange}
            placeholder="เช่น คุณสมชาย"
          />
        </label>

        <label>
          เบอร์โทรลูกค้า
          <input
            type="tel"
            name="customer_phone"
            value={form.customer_phone}
            onChange={handleChange}
            placeholder="เช่น 081-234-5678"
          />
        </label>

        <label>
          ที่อยู่ลูกค้า (จำเป็นสำหรับออกใบกำกับภาษี)
          <input
            type="text"
            name="customer_address"
            value={form.customer_address}
            onChange={handleChange}
            placeholder="เช่น 123 ถ.สุขุมวิท แขวง... เขต... กรุงเทพฯ 10110"
          />
        </label>

        <label>
          ทะเบียนรถ
          <input
            type="text"
            name="license_plate"
            value={form.license_plate}
            onChange={handleChange}
            placeholder="เช่น กข 1234 กรุงเทพฯ"
          />
        </label>

        <label>
          🔍 ค้นหารถ (ยี่ห้อ/รุ่น)
          <CarAutocomplete
            onSelect={(item) => {
              setForm((f) => ({
                ...f,
                car_brand: item?.brand_name || "",
                car_model: item?.model_name || "",
              }));
              setSelectedGeneration(item);
            }}
          />
        </label>

        <label>
          ที่มา
          <select name="source_type" value={form.source_type} onChange={handleChange}>
            {JOB_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label>
          แผนภาพจุดเสียหาย (แตะบนรูปเพื่อมาร์กจุด — ไม่บังคับ)
          <CarDamageDiagram
            points={damagePoints}
            onChange={setDamagePoints}
            carType={carDiagramType}
            onCarTypeChange={setCarDiagramType}
          />
        </label>

        <label>
          หมายเหตุ
          <input
            type="text"
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="เช่น รอยบุบข้างซ้าย ไฟหน้าแตก"
          />
        </label>

        {groups.length > 0 && (
          <label>
            ให้ใครเห็นงานนี้บ้าง (เลือกได้หลายกลุ่ม — ไม่เลือกเลย = ทุกคนในอู่เห็นได้)
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {groups.map((g) => {
                const isSelected = selectedGroupIds.includes(g.group_id);
                return (
                  <button
                    key={g.group_id}
                    type="button"
                    onClick={() => toggleGroup(g.group_id)}
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
            </div>
          </label>
        )}

        <label>
          ขั้นตอนการทำงาน (คร่าวๆ ก่อน — เพิ่ม/แก้ทีหลังได้)
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {workflowSteps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <span style={{ alignSelf: "center", fontSize: 12, color: "var(--text-muted)", width: 18 }}>
                  {i + 1}.
                </span>
                <input
                  type="text"
                  placeholder="เช่น รื้อตรวจสภาพ"
                  value={step.step_name}
                  onChange={(e) => handleStepChange(i, "step_name", e.target.value)}
                  style={{ flex: 1 }}
                />
                <select
                  value={step.assigned_to}
                  onChange={(e) => handleStepChange(i, "assigned_to", e.target.value)}
                  style={{ width: 130, fontSize: 12 }}
                >
                  <option value="">ยังไม่มอบหมาย</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {memberLabel(m)}
                    </option>
                  ))}
                </select>
                {workflowSteps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStepRow(i)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "var(--danger-text)",
                      cursor: "pointer",
                      fontSize: 16,
                      padding: "0 6px",
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addStepRow}
              style={{
                padding: 10,
                borderRadius: 8,
                border: "1px dashed var(--border-strong)",
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              + เพิ่มขั้นตอน
            </button>
          </div>
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "กำลังบันทึก..." : "รับงานเข้าอู่"}
        </button>
      </form>
    </div>
  );
}

export default function NewJobPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <NewJobPageContent />
    </RequireAuth>
  );
}
