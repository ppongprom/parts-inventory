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

  // ค้นทะเบียนรถจากงานเก่าของร้านนี้ — พิมพ์ทะเบียนก่อนชื่อลูกค้า ถ้าเจอเคยรับงานคันนี้มาก่อน
  // ดึงทั้งข้อมูลลูกค้า+รถจากงานล่าสุดที่ทะเบียนตรงมาเติมให้ (แก้ไขต่อได้อิสระ ไม่ล็อก)
  const [plateResults, setPlateResults] = useState([]);
  const plateSearchIdRef = useRef(0);
  // ช่องชื่อลูกค้าเป็นช่องค้นหาเสมอ — เผื่อกรณีลูกค้าเก่าแต่รถคันใหม่ (ทะเบียนหาไม่เจอ) เลือกแล้ว
  // เติมแค่เบอร์/ที่อยู่ ไม่แตะทะเบียนที่พิมพ์ไว้
  const [customerResults, setCustomerResults] = useState([]);
  const customerSearchIdRef = useRef(0);

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

  async function searchPlateHistory(query) {
    setForm((f) => ({ ...f, license_plate: query }));
    const searchId = ++plateSearchIdRef.current;
    if (!query.trim() || !currentShopId) {
      setPlateResults([]);
      return;
    }
    const { data } = await supabase
      .from("jobs")
      .select(
        "job_id, license_plate, customer_name, customer_phone, customer_address, car_brand, car_model, car_year_display, generation_id, trim_id, created_at"
      )
      .eq("shop_id", currentShopId)
      .ilike("license_plate", `%${query.trim()}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    // กันผลลัพธ์เก่าที่ query ช้ากว่ามาทับผลของ query ที่พิมพ์ทีหลัง (เช่นลบข้อความจนช่องว่างแล้ว
    // แต่ response ของคำค้นก่อนหน้ายังไม่กลับมา)
    if (searchId !== plateSearchIdRef.current) return;

    // ทะเบียนเดียวกันอาจเคยโผล่หลายงาน (เปลี่ยนเจ้าของรถก็เป็นไปได้) — เอาแค่งานล่าสุดต่อ 1 ทะเบียน
    const seen = new Set();
    const deduped = [];
    for (const row of data || []) {
      const key = (row.license_plate || "").trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(row);
      if (deduped.length >= 8) break;
    }
    setPlateResults(deduped);
  }

  function selectPlateHistory(row) {
    setForm((f) => ({
      ...f,
      license_plate: row.license_plate || "",
      customer_name: row.customer_name || "",
      customer_phone: row.customer_phone || "",
      customer_address: row.customer_address || "",
      car_brand: row.car_brand || "",
      car_model: row.car_model || "",
    }));
    setSelectedGeneration(
      row.generation_id
        ? { year_range_display: row.car_year_display, generation_id: row.generation_id, trim_id: row.trim_id }
        : null
    );
    setPlateResults([]);
  }

  async function searchCustomers(query) {
    setForm((f) => ({ ...f, customer_name: query }));
    const searchId = ++customerSearchIdRef.current;
    if (!query.trim() || !currentShopId) {
      setCustomerResults([]);
      return;
    }
    const { data } = await supabase
      .from("customers")
      .select("customer_id, name, phone, address")
      .eq("shop_id", currentShopId)
      .ilike("name", `%${query.trim()}%`)
      .limit(8);
    if (searchId !== customerSearchIdRef.current) return;
    setCustomerResults(data || []);
  }

  function selectCustomer(c) {
    // ตั้งใจไม่แตะ license_plate — เคสนี้คือลูกค้าเก่าเอารถคันใหม่มา ทะเบียนที่พิมพ์ไว้ต้องคงอยู่
    setForm((f) => ({
      ...f,
      customer_name: c.name || "",
      customer_phone: c.phone || "",
      customer_address: c.address || "",
    }));
    setCustomerResults([]);
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

      // แก้ JOB-202/203: เดิม insert jobs -> job_visibility_groups -> job_workflow_steps
      // แยก 3 คำสั่งอิสระ ถ้าคำสั่งกลาง/ท้ายล้มเหลว จะเหลือ job ที่ "เห็นได้ทุกคน" ค้างอยู่
      // (ข้อมูลรั่ว) และกด submit ซ้ำจะได้ job ซ้ำอีกใบ — ตอนนี้ครอบทั้ง 3 ส่วนเป็น RPC เดียว
      // (create_job_atomic, db/atomic_job_creation_migration.sql) เป็น transaction เดียวจริง
      // ถ้าส่วนไหนใน RPC fail ทั้งก้อน rollback หมด ไม่มี partial state หลงเหลือ
      const validSteps = workflowSteps.filter((s) => s.step_name.trim());

      const { data: newJob, error } = await supabase.rpc("create_job_atomic", {
        p_shop_id: currentShopId,
        p_customer_id: customerId,
        p_customer_name: form.customer_name || null,
        p_customer_phone: form.customer_phone || null,
        p_customer_address: form.customer_address || null,
        p_car_brand: form.car_brand || null,
        p_car_model: form.car_model || null,
        p_car_year_display: selectedGeneration?.year_range_display || null,
        p_generation_id: selectedGeneration?.generation_id || null,
        p_trim_id: selectedGeneration?.trim_id || null,
        p_license_plate: form.license_plate || null,
        p_source_type: form.source_type || null,
        p_notes: form.notes || null,
        p_photo_urls: photoUrls,
        p_damage_points: damagePoints,
        p_car_diagram_type: carDiagramType,
        p_created_by: user?.id || null,
        p_group_ids: selectedGroupIds, // เลือกได้หลายกลุ่ม — ไม่เลือกเลย = ทุกคนเห็น (เจตนา ไม่ใช่บั๊ก)
        p_workflow_steps: validSteps.map((s) => ({
          step_name: s.step_name.trim(),
          assigned_to: s.assigned_to || null,
        })),
      });

      if (error) throw error;

      setMsg({ type: "success", text: "รับงานเรียบร้อยแล้ว ✅" });
      setTimeout(() => router.push(`/jobs/${newJob.job_id}`), 600);
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
        <div>
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
        </div>

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
          ทะเบียนรถ
          <div style={{ position: "relative" }}>
            <input
              type="text"
              name="license_plate"
              value={form.license_plate}
              onChange={(e) => searchPlateHistory(e.target.value)}
              placeholder="เช่น กข 1234 กรุงเทพฯ — พิมพ์ค้นงานเก่าได้เลย"
              autoComplete="off"
            />
            {plateResults.length > 0 && (
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
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {plateResults.map((row) => (
                  <button
                    key={row.job_id}
                    type="button"
                    onClick={() => selectPlateHistory(row)}
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
                    🚗 {row.license_plate} — {row.customer_name || "ไม่ระบุลูกค้า"}
                    {row.car_brand ? ` (${row.car_brand} ${row.car_model || ""})` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
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
          {/* CarAutocomplete เก็บ query แสดงผลไว้ในตัวเอง ไม่รับ value จากภายนอก — ตอนดึงยี่ห้อ/รุ่น
              มาจากประวัติทะเบียนเก่า (selectPlateHistory) ช่องค้นหาเลยไม่โชว์อะไรทั้งที่ set ค่าจริง
              ไว้แล้ว ใส่บรรทัดยืนยันแยกกันสับสนว่ายังไม่ได้เลือกรถ */}
          {form.car_brand && (
            <div
              style={{
                fontSize: 12,
                color: "var(--zone-text)",
                background: "var(--zone-bg)",
                padding: 8,
                borderRadius: 8,
              }}
            >
              🚗 {form.car_brand} {form.car_model}
              {selectedGeneration?.year_range_display ? ` · ${selectedGeneration.year_range_display}` : ""}
            </div>
          )}
        </div>

        <label>
          ชื่อลูกค้า
          <div style={{ position: "relative" }}>
            <input
              type="text"
              name="customer_name"
              value={form.customer_name}
              onChange={(e) => searchCustomers(e.target.value)}
              placeholder="เช่น คุณสมชาย — พิมพ์ค้นลูกค้าเก่าได้เลย"
              autoComplete="off"
            />
            {customerResults.length > 0 && (
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
                  maxHeight: 240,
                  overflowY: "auto",
                }}
              >
                {customerResults.map((c) => (
                  <button
                    key={c.customer_id}
                    type="button"
                    onClick={() => selectCustomer(c)}
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
                    👤 {c.name || "ไม่ระบุชื่อ"} {c.phone ? `— ${c.phone}` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
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
          ที่มา
          <select name="source_type" value={form.source_type} onChange={handleChange}>
            {JOB_SOURCE_TYPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <div style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 6 }}>
          แผนภาพจุดเสียหาย (แตะบนรูปเพื่อมาร์กจุด — ไม่บังคับ)
          <CarDamageDiagram
            points={damagePoints}
            onChange={setDamagePoints}
            carType={carDiagramType}
            onCarTypeChange={setCarDiagramType}
          />
        </div>

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
          <div>
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
          </div>
        )}

        <div>
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
        </div>

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
