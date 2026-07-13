"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import CarAutocomplete from "../../components/CarAutocomplete";
import { checkYearOutOfRange } from "../../lib/yearValidation";
import { getDefaultZone, setDefaultZone } from "../../lib/zoneStorage";

export default function AddPartPage() {
  const router = useRouter();
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    part_name: "",
    car_brand: "",
    car_model: "",
    car_year: "",
    condition: "",
    zone_code: "",
    source_type: "",
    price: "",
  });
  const [yearHint, setYearHint] = useState(null); // { start, end }
  const [photoFile, setPhotoFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null); // { type: 'success'|'error', text }

  const [zones, setZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(true);

  const [conditions, setConditions] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  useEffect(() => {
    // ตั้งค่าโซน default จากที่เลือกล่าสุด
    const lastZone = getDefaultZone();
    if (lastZone) {
      setForm((f) => ({ ...f, zone_code: lastZone }));
    }
    fetchZones();
    fetchOptions();
  }, []);

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
      const cond = data.filter((o) => o.category === "condition").map((o) => o.value);
      const src = data.filter((o) => o.category === "source_type").map((o) => o.value);
      setConditions(cond);
      setSourceTypes(src);
      setForm((f) => ({
        ...f,
        condition: f.condition || cond[0] || "",
        source_type: f.source_type || src[0] || "",
      }));
    }
    setOptionsLoading(false);
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

  const yearOutOfRange = checkYearOutOfRange(form.car_year, yearHint);

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
      let photo_url = null;

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

      const { error: insertError } = await supabase.from("parts").insert({
        part_name: form.part_name,
        car_brand: form.car_brand || null,
        car_model: form.car_model || null,
        car_year: form.car_year ? Number(form.car_year) : null,
        condition: form.condition || null,
        zone_code: form.zone_code || null,
        source_type: form.source_type || null,
        price: form.price ? Number(form.price) : null,
        photo_url,
        status: "available",
      });

      if (insertError) throw insertError;

      const keepZone = form.zone_code;

      setMsg({ type: "success", text: "บันทึกอะไหล่เรียบร้อยแล้ว ✅" });
      setForm({
        part_name: "",
        car_brand: "",
        car_model: "",
        car_year: "",
        condition: conditions[0] || "",
        zone_code: keepZone, // โซนล่าสุดยังอยู่ ให้ใช้ต่อได้เลย
        source_type: sourceTypes[0] || "",
        price: "",
      });
      setYearHint(null);
      setPhotoFile(null);
      setPreview(null);

      setTimeout(() => {
        router.push("/");
      }, 800);
    } catch (err) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>+ เพิ่มอะไหล่ใหม่</h1>
        <Link href="/" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <form onSubmit={handleSubmit}>
        <label>
          รูปอะไหล่
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
            📷 {preview ? "ถ่ายใหม่ / เลือกรูปใหม่" : "ถ่ายรูปอะไหล่"}
          </button>
        </label>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={preview}
            alt="preview"
            style={{ width: 140, height: 140, objectFit: "cover", borderRadius: 8 }}
          />
        )}

        <label>
          ชื่อชิ้นส่วน *
          <input
            type="text"
            name="part_name"
            value={form.part_name}
            onChange={handleChange}
            placeholder="เช่น ประตูขวา, กันชนหน้า"
            required
          />
        </label>

        <label>
          🔍 ค้นหารถ (ยี่ห้อ/รุ่น)
          <CarAutocomplete
            onSelect={(item) => {
              setForm((f) => ({
                ...f,
                car_brand: item.brand,
                car_model: item.model,
                car_year:
                  f.car_year || (item.year_start !== "" ? item.year_start : ""),
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
            value={form.car_brand}
            onChange={handleChange}
            placeholder="เช่น Nissan"
          />
        </label>

        <label>
          รุ่นรถ
          <input
            type="text"
            name="car_model"
            value={form.car_model}
            onChange={handleChange}
            placeholder="เช่น March"
          />
        </label>

        <label>
          ปีรถ
          <input
            type="number"
            name="car_year"
            value={form.car_year}
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
          <select name="condition" value={form.condition} onChange={handleChange}>
            {conditions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
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
          <select name="source_type" value={form.source_type} onChange={handleChange}>
            {sourceTypes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {!optionsLoading && sourceTypes.length === 0 && (
            <span style={{ fontSize: 12, color: "#6b7280" }}>
              ยังไม่มีตัวเลือก —{" "}
              <Link href="/admin/options" style={{ color: "#93c5fd" }}>
                เพิ่มที่หน้าตั้งค่า
              </Link>
            </span>
          )}
        </label>

        <label>
          โซนจัดเก็บ
          <select name="zone_code" value={form.zone_code} onChange={handleZoneChange}>
            <option value="">ไม่ระบุโซน</option>
            {zones.map((z) => (
              <option key={z.id} value={z.code}>
                {z.code}
                {z.name ? ` — ${z.name}` : ""}
              </option>
            ))}
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
            value={form.price}
            onChange={handleChange}
            placeholder="ไม่บังคับ"
          />
        </label>

        <button type="submit" disabled={saving}>
          {saving ? "กำลังบันทึก..." : "บันทึกอะไหล่"}
        </button>
      </form>
    </div>
  );
}
