"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";
import CarAutocomplete from "../../components/CarAutocomplete";
import TrimSelect from "../../components/TrimSelect";
import { getDefaultZone, setDefaultZone } from "../../lib/zoneStorage";
import { resizeImageFile } from "../../lib/imageResize";
import { uploadPartPhotos } from "../../lib/storageHelpers";
import { useAuth } from "../../lib/AuthProvider";
import RequireAuth from "../../components/RequireAuth";

function AddPartPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedJobId = searchParams.get("job_id");
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const { currentShopId } = useAuth();

  const [form, setForm] = useState({
    item_type: "salvage",
    part_name: "",
    car_brand: "",
    car_model: "",
    condition: "",
    zone_code: "",
    source_type: "",
    quantity: "1",
    min_stock_level: "",
    price: "",
    part_number: "",
    notes: "",
  });

  // ข้อมูลปี — มาจากฐานข้อมูลเท่านั้น ห้าม user พิมพ์เอง
  const [selectedGeneration, setSelectedGeneration] = useState(null); // { generation_id, year_range_display, ... }

  const [photos, setPhotos] = useState([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [lightboxUrl, setLightboxUrl] = useState(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const [zones, setZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(true);

  const [conditions, setConditions] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  useEffect(() => {
    const lastZone = getDefaultZone();
    if (lastZone) {
      setForm((f) => ({ ...f, zone_code: lastZone }));
    }
    if (currentShopId) {
      fetchZones();
      fetchOptions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function fetchZones() {
    setZonesLoading(true);
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .eq("shop_id", currentShopId)
      .order("code", { ascending: true });
    if (!error) setZones(data || []);
    setZonesLoading(false);
  }

  async function fetchOptions() {
    setOptionsLoading(true);
    const { data, error } = await supabase
      .from("options")
      .select("*")
      .eq("shop_id", currentShopId)
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

  // ลิงก์ช่วยค้นเบอร์อะไหล่ — deep-link ไปหน้า catalog ของยี่ห้อรถที่เลือกไว้
  // หมายเหตุ: ลิงก์ระดับ "ยี่ห้อ" เท่านั้น เพราะ id ของแต่ละรุ่นในเว็บเหล่านี้เป็น token
  // ภายในที่เดารูปแบบไม่ได้ ผู้ใช้ต้องคลิกเลือกรุ่นต่อเองอีก 1 ครั้งจากหน้ายี่ห้อ
  function getPartSouqUrl() {
    const brand = (form.car_brand || "").trim();
    if (!brand) return "https://partsouq.com/en/catalog/genuine";
    return `https://partsouq.com/en/catalog/genuine/locate?c=${encodeURIComponent(brand)}`;
  }

  function getAmayamaUrl() {
    const brand = (form.car_brand || "").trim().toLowerCase().replace(/\s+/g, "-");
    if (!brand) return "https://www.amayama.com/en/genuine-catalogs";
    return `https://www.amayama.com/en/genuine-catalogs/${encodeURIComponent(brand)}`;
  }

  function handleZoneChange(e) {
    const value = e.target.value;
    setForm((f) => ({ ...f, zone_code: value }));
    setDefaultZone(value);
  }

  async function handlePhotoChange(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setProcessingPhoto(true);
    setPhotoError("");

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

    if (photos.length === 0) {
      setPhotoError("ต้องมีรูปอย่างน้อย 1 รูปก่อนบันทึก");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const photoUrls = await uploadPartPhotos(photos.map((p) => p.file));

      const { error: insertError } = await supabase.from("parts").insert({
        shop_id: currentShopId,
        part_name: form.part_name,
        car_brand: form.car_brand || null,
        car_model: form.car_model || null,
        generation_id: selectedGeneration?.generation_id || null,
        car_year_display: selectedGeneration?.year_range_display || null,
        trim_id: selectedGeneration?.trim_id || null,
        condition: form.condition || null,
        zone_code: form.zone_code || null,
        source_type: form.source_type || null,
        quantity: form.quantity ? Number(form.quantity) : 1,
        item_type: form.item_type,
        job_id: linkedJobId || null,
        min_stock_level: form.min_stock_level ? Number(form.min_stock_level) : null,
        price: form.price ? Number(form.price) : null,
        part_number: form.part_number || null,
        notes: form.notes || null,
        photo_url: photoUrls[0] || null,
        photo_urls: photoUrls,
        status: "available",
        is_active: true,
      });

      if (insertError) throw insertError;

      const keepZone = form.zone_code;

      setMsg({ type: "success", text: "บันทึกอะไหล่เรียบร้อยแล้ว ✅" });
      setForm({
        part_name: "",
        car_brand: "",
        car_model: "",
        condition: conditions[0] || "",
        zone_code: keepZone,
        source_type: sourceTypes[0] || "",
        price: "",
        part_number: "",
      });
      setSelectedGeneration(null);
      setPhotos([]);
      setPhotoError("");

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
          รูปอะไหล่ * (อย่างน้อย 1 รูป เพิ่มได้หลายรูป)
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
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
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
                fontSize: 15,
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              🖼️ {processingPhoto ? "กำลังประมวลผล..." : "เลือกจากคลังภาพ"}
            </button>
          </div>
        </label>

        {photos.length > 0 && (
          <div className="photo-thumb-row">
            {photos.map((p, i) => (
              <div className="photo-thumb" key={i}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={`รูป ${i + 1}`}
                  onClick={() => setLightboxUrl(p.previewUrl)}
                />
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={() => handleRemovePhoto(i)}
                  aria-label="ลบรูปนี้"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {photoError && <span style={{ fontSize: 12, color: "var(--danger-text)" }}>{photoError}</span>}

        {lightboxUrl && (
          <div
            onClick={() => setLightboxUrl(null)}
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
              src={lightboxUrl}
              alt="ขยายรูป"
              style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
            />
          </div>
        )}

        {linkedJobId && (
          <div
            style={{
              padding: 10,
              borderRadius: 8,
              background: "var(--zone-bg)",
              color: "var(--zone-text)",
              fontSize: 13,
            }}
          >
            🔗 อะไหล่ชิ้นนี้จะผูกกับงาน #{linkedJobId} อัตโนมัติ
          </div>
        )}

        <label>
          ประเภทอะไหล่ *
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, item_type: "salvage" }))}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: form.item_type === "salvage" ? "#2563eb" : "var(--surface)",
                color: form.item_type === "salvage" ? "white" : "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🔧 อะไหล่ถอด
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, item_type: "consumable" }))}
              style={{
                flex: 1,
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--border-strong)",
                background: form.item_type === "consumable" ? "#0f766e" : "var(--surface)",
                color: form.item_type === "consumable" ? "white" : "var(--text)",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              🧴 ของสิ้นเปลือง
            </button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {form.item_type === "salvage"
              ? "อะไหล่ถอดจากรถชน/น้ำท่วม รอขาย (ประตู, กันชน, เครื่องยนต์ ฯลฯ)"
              : "ของใช้สิ้นเปลืองในงานซ่อม (น้ำมันเครื่อง, ไส้กรอง, ผ้าเบรก ฯลฯ)"}
          </div>
        </label>

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
                car_brand: item?.brand_name || "",
                car_model: item?.model_name || "",
              }));
              setSelectedGeneration(item);
            }}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
            เลือกจากรายการที่ค้นเจอเท่านั้น — ถ้าไม่เจอรุ่นที่ต้องการ แจ้งแอดมินให้เพิ่มในฐานข้อมูลก่อน
            เพื่อกันข้อมูลปี/รุ่นเพี้ยน
          </div>
        </label>

        <TrimSelect
          generationId={selectedGeneration?.generation_id}
          onChange={(trim) =>
            setSelectedGeneration((g) =>
              g ? { ...g, trim_id: trim?.trim_id || null, trim_name: trim?.trim_name || null } : g
            )
          }
        />

        <label>
          ปีที่ผลิต (ดึงจากฐานข้อมูลอัตโนมัติ — แก้เองไม่ได้)
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: "var(--surface-dim)",
              color: selectedGeneration ? "var(--text)" : "var(--text-muted)",
              fontSize: 14,
            }}
          >
            {selectedGeneration
              ? `${selectedGeneration.year_range_display}${
                  selectedGeneration.generation_code
                    ? ` (${selectedGeneration.generation_code})`
                    : ""
                }${selectedGeneration.trim_name ? ` · รุ่นย่อย: ${selectedGeneration.trim_name}` : ""}`
              : "— เลือกรถจากช่องค้นหาด้านบนก่อน จะขึ้นปีให้อัตโนมัติ —"}
          </div>
        </label>

        <label>
          เลขที่อะไหล่ (Part Number) — ไม่บังคับ
          <input
            type="text"
            name="part_number"
            value={form.part_number}
            onChange={handleChange}
            placeholder="เช่น 67002-0K120"
          />
          <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
            <a
              href={getPartSouqUrl()}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--link)" }}
            >
              🔍 ค้นเบอร์ที่ PartSouq
            </a>
            <a
              href={getAmayamaUrl()}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 12, color: "var(--link)" }}
            >
              🔍 ค้นเบอร์ที่ Amayama
            </a>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {form.car_brand
              ? `จะพาไปหน้า catalog ของ "${form.car_brand}" แล้วเลือกรุ่นต่อเอง`
              : "เลือก/พิมพ์ยี่ห้อรถก่อน ลิงก์จะพาไปตรงยี่ห้อนั้นให้อัตโนมัติ"}
          </div>
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
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ยังไม่มีตัวเลือก —{" "}
              <Link href="/admin/options" style={{ color: "var(--link)" }}>
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
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ยังไม่มีตัวเลือก —{" "}
              <Link href="/admin/options" style={{ color: "var(--link)" }}>
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
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              ยังไม่มีโซนในระบบ —{" "}
              <Link href="/admin/zones" style={{ color: "var(--link)" }}>
                เพิ่มโซนก่อน
              </Link>
            </span>
          )}
        </label>

        <label>
          จำนวน
          <input
            type="number"
            name="quantity"
            value={form.quantity}
            onChange={handleChange}
            placeholder="1"
            min="0"
            step="any"
          />
        </label>

        {form.item_type === "consumable" && (
          <label>
            แจ้งเตือนเมื่อเหลือน้อยกว่า (ไม่บังคับ)
            <input
              type="number"
              name="min_stock_level"
              value={form.min_stock_level}
              onChange={handleChange}
              placeholder="เช่น 5"
              min="0"
              step="any"
            />
          </label>
        )}

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

        <label>
          หมายเหตุ
          <input
            type="text"
            name="notes"
            value={form.notes}
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

export default function AddPartPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <Suspense fallback={<div className="container">กำลังโหลด...</div>}>
        <AddPartPageContent />
      </Suspense>
    </RequireAuth>
  );
}

