"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import CarAutocomplete from "../../../components/CarAutocomplete";
import { checkYearOutOfRange } from "../../../lib/yearValidation";
import { getDefaultZone, setDefaultZone } from "../../../lib/zoneStorage";

export default function EditPartPage() {
  const params = useParams();
  const router = useRouter();
  const { id } = params;
  const fileInputRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState(null);
  const [yearHint, setYearHint] = useState(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [zones, setZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(true);

  const [conditions, setConditions] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  useEffect(() => {
    fetchPart();
    fetchZones();
    fetchOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function fetchZones() {
    setZonesLoading(true);
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .order("code", { ascending: true });
    if (!error) setZones(data || []);
    setZonesLoading(false);
  }

  async function fetchOptions() {
    setOptionsLoading(true);
    const { data, error } = await supabase
      .from("options")
      .select("*")
      .order("sort_order", { ascending: true });

    if (!error && data) {
      setConditions(data.filter((o) => o.category === "condition").map((o) => o.value));
      setSourceTypes(data.filter((o) => o.category === "source_type").map((o) => o.value));
      setStatuses(data.filter((o) => o.category === "status").map((o) => o.value));
    }
    setOptionsLoading(false);
  }

  async function fetchPart() {
    setLoading(true);
    setMsg(null);
    const { data, error } = await supabase
      .from("parts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      setMsg({ type: "error", text: "โหลดข้อมูลไม่สำเร็จ: " + error.message });
    } else {
      setForm(data);
      setPreview(data.photo_url);
    }
    setLoading(false);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  }

  function handleZoneChange(e) {
    const value = e.target.value;
    setForm((f) => ({ ...f, zone_code: value }));
    setDefaultZone(value);
  }

  function handlePhotoChange(e) {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPreview(URL.createObjectURL(file));
    }
  }

  const yearOutOfRange = form
    ? checkYearOutOfRange(form.car_year, yearHint)
    : false;

  async function handleSubmit(e) {
    e.preventDefault();

    if (yearOutOfRange) {
      const confirmed = window.confirm(
        `ปีที่กรอก (${form.car_year}) อยู่นอกช่วงที่รุ่นนี้ผลิตจริง (${yearHint.start}–${yearHint.end})\n\nต้องการบันทึกต่อไหม? กรุณาตรวจสอบข้อมูลอีกครั้งก่อนยืนยัน`
      );
      if (!confirmed) return;
    }

    setSaving(true);
    setMsg(null);

    try {
      let photo_url = form.photo_url;

      if (photoFile) {
        const fileExt = photoFile.name.split(".").pop();
        const fileName = `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from("part-photos")
          .upload(fileName, photoFile);

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("part-photos")
          .getPublicUrl(fileName);

        photo_url = publicUrlData.publicUrl;
      }

      const { error: updateError } = await supabase
        .from("parts")
        .update({
          part_name: form.part_name,
          car_brand: form.car_brand || null,
          car_model: form.car_model || null,
          car_year: form.car_year ? Number(form.car_year) : null,
          condition: form.condition || null,
          zone_code: form.zone_code || null,
          source_type: form.source_type || null,
          status: form.status || null,
          price: form.price ? Number(form.price) : null,
          photo_url,
        })
        .eq("id", id);

      if (updateError) throw updateError;

      setMsg({ type: "success", text: "บันทึกการแก้ไขเรียบร้อยแล้ว ✅" });
      setTimeout(() => {
        router.push("/");
      }, 800);
    } catch (err) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `ลบ "${form.part_name}" ออกจากสต็อกใช่ไหม? การลบนี้กู้คืนไม่ได้`
    );
    if (!confirmed) return;

    setDeleting(true);
    setMsg(null);

    try {
      const { error } = await supabase.from("parts").delete().eq("id", id);
      if (error) throw error;

      router.push("/");
    } catch (err) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + err.message });
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังโหลด...</div>
      </div>
    );
  }

  if (!form) {
    return (
      <div className="container">
        {msg && <div className={`msg ${msg.type}`}>{msg.text}</div>}
        <Link href="/" className="nav-link secondary" style={{ marginTop: 16, display: "inline-block" }}>
          ← กลับหน้าแรก
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>✏️ แก้ไขอะไหล่</h1>
        <Link href="/" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          รูปภาพ
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoChange}
            style={{ display: "none" }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: 14,
              borderRadius: 8,
              border: "1px dashed #333844",
              background: "#1a1d24",
              color: "#e8e8e8",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            📷 ถ่ายใหม่ / เลือกรูปใหม่
          </button>
        </label>

        {preview && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="preview"
              onClick={() => setLightboxOpen(true)}
              style={{
                width: 140,
                height: 140,
                objectFit: "cover",
                borderRadius: 8,
                cursor: "zoom-in",
              }}
            />
            <span style={{ fontSize: 12, color: "#6b7280", marginTop: -8 }}>
              คลิกรูปเพื่อดูขนาดใหญ่
            </span>
          </>
        )}

        {lightboxOpen && (
          <div
            onClick={() => setLightboxOpen(false)}
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
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="ขยายรูป"
              style={{
                maxWidth: "100%",
                maxHeight: "100%",
                borderRadius: 8,
                objectFit: "contain",
              }}
            />
          </div>
        )}

        <label>
          ชื่อชิ้นส่วน *
          <input
            type="text"
            name="part_name"
            value={form.part_name || ""}
            onChange={handleChange}
            required
          />
        </label>

        <label>
          🔍 ค้นหารถ (ยี่ห้อ/รุ่น) — เปลี่ยนถ้าต้องการ
          <CarAutocomplete
            onSelect={(item) => {
              setForm((f) => ({
                ...f,
                car_brand: item.brand,
                car_model: item.model,
                car_year: item.year_start !== "" ? item.year_start : f.car_year,
              }));
              setYearHint({ start: item.year_start, end: item.year_end });
            }}
          />
        </label>

        <label>
          ยี่ห้อรถ
          <input
            type="text"
            name="car_brand"
            value={form.car_brand || ""}
            onChange={handleChange}
          />
        </label>

        <label>
          รุ่นรถ
          <input
            type="text"
            name="car_model"
            value={form.car_model || ""}
            onChange={handleChange}
          />
        </label>

        <label>
          ปีรถ
          <input
            type="number"
            name="car_year"
            value={form.car_year || ""}
            onChange={handleChange}
            placeholder="เช่น 2015"
            style={yearOutOfRange ? { borderColor: "#d97706" } : undefined}
          />
          {yearHint && !yearOutOfRange && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              รุ่นนี้ผลิตช่วง {yearHint.start}–{yearHint.end}
            </span>
          )}
          {yearOutOfRange && (
            <span style={{ fontSize: 12, color: "#fbbf24" }}>
              ⚠️ ปีนี้อยู่นอกช่วงที่รุ่นนี้ผลิต ({yearHint.start}–{yearHint.end}) —
              ยังกรอกต่อได้ แต่ระบบจะถามยืนยันอีกครั้งตอนบันทึก
            </span>
          )}
        </label>

        <label>
          สภาพ
          <select name="condition" value={form.condition || ""} onChange={handleChange}>
            <option value="">— เลือก —</option>
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {form.condition && !conditions.includes(form.condition) && (
              <option value={form.condition}>{form.condition} (ไม่อยู่ในลิสต์แล้ว)</option>
            )}
          </select>
          {!optionsLoading && conditions.length === 0 && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              ยังไม่มีตัวเลือก —{" "}
              <Link href="/admin/options" style={{ color: "#93c5fd" }}>
                เพิ่มที่หน้าตั้งค่า
              </Link>
            </span>
          )}
        </label>

        <label>
          ที่มา
          <select name="source_type" value={form.source_type || ""} onChange={handleChange}>
            <option value="">— เลือก —</option>
            {sourceTypes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {form.source_type && !sourceTypes.includes(form.source_type) && (
              <option value={form.source_type}>{form.source_type} (ไม่อยู่ในลิสต์แล้ว)</option>
            )}
          </select>
        </label>

        <label>
          สถานะ
          <select name="status" value={form.status || ""} onChange={handleChange}>
            <option value="">— เลือก —</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {form.status && !statuses.includes(form.status) && (
              <option value={form.status}>{form.status} (ไม่อยู่ในลิสต์แล้ว)</option>
            )}
          </select>
        </label>

        <label>
          โซนจัดเก็บ
          <select name="zone_code" value={form.zone_code || ""} onChange={handleZoneChange}>
            <option value="">ไม่ระบุโซน</option>
            {zones.map((z) => (
              <option key={z.id} value={z.code}>
                {z.code}
                {z.name ? ` — ${z.name}` : ""}
              </option>
            ))}
            {/* เผื่อโซนเดิมของ record นี้ไม่อยู่ในลิสต์ปัจจุบันแล้ว (ถูกลบไปจาก admin) */}
            {form.zone_code && !zones.some((z) => z.code === form.zone_code) && (
              <option value={form.zone_code}>{form.zone_code} (ไม่อยู่ในลิสต์แล้ว)</option>
            )}
          </select>
          {!zonesLoading && zones.length === 0 && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              ยังไม่มีโซนในระบบ —{" "}
              <Link href="/admin/zones" style={{ color: "#93c5fd" }}>
                เพิ่มโซนก่อน
              </Link>
            </span>
          )}
        </label>

        <label>
          ราคา (บาท)
          <input
            type="number"
            name="price"
            value={form.price || ""}
            onChange={handleChange}
          />
        </label>

        <button type="submit" disabled={saving || deleting}>
          {saving ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}
        </button>
      </form>

      <button
        type="button"
        onClick={handleDelete}
        disabled={saving || deleting}
        style={{
          marginTop: 12,
          width: "100%",
          padding: 14,
          borderRadius: 8,
          border: "1px solid #7f1d1d",
          background: "transparent",
          color: "#fca5a5",
          fontSize: 15,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {deleting ? "กำลังลบ..." : "🗑️ ลบอะไหล่นี้"}
      </button>
    </div>
  );
}
