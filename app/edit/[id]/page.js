"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabaseClient";
import CarAutocomplete from "../../../components/CarAutocomplete";
import { getDefaultZone, setDefaultZone } from "../../../lib/zoneStorage";
import { resizeImageFile } from "../../../lib/imageResize";
import { uploadPartPhotos } from "../../../lib/storageHelpers";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

function EditPartPageContent() {
  const params = useParams();
  const router = useRouter();
  const { id } = params;
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const { currentShopId, currentRole } = useAuth();

  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);

  // ปี — ดึงจากฐานข้อมูลเท่านั้น ห้าม user พิมพ์เอง
  const [selectedGeneration, setSelectedGeneration] = useState(null);

  const [existingPhotos, setExistingPhotos] = useState([]);
  const [newPhotos, setNewPhotos] = useState([]);
  const [processingPhoto, setProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState(null);

  const [zones, setZones] = useState([]);
  const [zonesLoading, setZonesLoading] = useState(true);

  const [conditions, setConditions] = useState([]);
  const [sourceTypes, setSourceTypes] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);

  useEffect(() => {
    if (!currentShopId) return;
    fetchPart();
    fetchZones();
    fetchOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, currentShopId]);

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
      const photos = data.photo_urls?.length
        ? data.photo_urls
        : data.photo_url
        ? [data.photo_url]
        : [];
      setExistingPhotos(photos);
      if (data.car_year_display) {
        setSelectedGeneration({
          generation_id: data.generation_id,
          year_range_display: data.car_year_display,
          generation_code: null,
        });
      }
    }
    setLoading(false);
  }

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (name === "car_brand" || name === "car_model") {
      setSelectedGeneration(null);
    }
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

    setNewPhotos((prev) => [...prev, ...resizedList]);
    setProcessingPhoto(false);
    e.target.value = "";
  }

  function handleRemoveExistingPhoto(index) {
    setExistingPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  function handleRemoveNewPhoto(index) {
    setNewPhotos((prev) => prev.filter((_, i) => i !== index));
  }

  const totalPhotoCount = existingPhotos.length + newPhotos.length;
  const allPhotoUrls = [...existingPhotos, ...newPhotos.map((p) => p.previewUrl)];

  useEffect(() => {
    if (lightboxIndex === null) return;

    function handleKeyDown(e) {
      if (e.key === "ArrowLeft") {
        setLightboxIndex((i) => (i - 1 + allPhotoUrls.length) % allPhotoUrls.length);
      } else if (e.key === "ArrowRight") {
        setLightboxIndex((i) => (i + 1) % allPhotoUrls.length);
      } else if (e.key === "Escape") {
        setLightboxIndex(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, allPhotoUrls.length]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (totalPhotoCount === 0) {
      setPhotoError("ต้องมีรูปอย่างน้อย 1 รูปก่อนบันทึก");
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const uploadedUrls = await uploadPartPhotos(newPhotos.map((p) => p.file));
      const finalPhotoUrls = [...existingPhotos, ...uploadedUrls];

      const { error: updateError } = await supabase
        .from("parts")
        .update({
          part_name: form.part_name,
          car_brand: form.car_brand || null,
          car_model: form.car_model || null,
          generation_id: selectedGeneration?.generation_id || null,
          car_year_display: selectedGeneration?.year_range_display || null,
          condition: form.condition || null,
          zone_code: form.zone_code || null,
          source_type: form.source_type || null,
          status: form.status || null,
          price: form.price ? Number(form.price) : null,
          photo_url: finalPhotoUrls[0] || null,
          photo_urls: finalPhotoUrls,
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

  async function handleDeactivate() {
    const confirmed = window.confirm(
      `ซ่อน "${form.part_name}" จากหน้าแรกใช่ไหม?\n\n(ไม่ได้ลบถาวร — กู้คืนหรือลบถาวรได้ที่หน้าตั้งค่า > ถังขยะ)`
    );
    if (!confirmed) return;

    setDeleting(true);
    setMsg(null);

    try {
      const { error } = await supabase
        .from("parts")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;

      router.push("/");
    } catch (err) {
      setMsg({ type: "error", text: "ดำเนินการไม่สำเร็จ: " + err.message });
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
          รูปภาพ * (อย่างน้อย 1 รูป เพิ่มได้หลายรูป)
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
              🖼️ {processingPhoto ? "กำลังประมวลผล..." : "เลือกจากคลังภาพ"}
            </button>
          </div>
        </label>

        {(existingPhotos.length > 0 || newPhotos.length > 0) && (
          <div className="photo-thumb-row">
            {existingPhotos.map((url, i) => (
              <div className="photo-thumb" key={`existing-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`รูปเดิม ${i + 1}`} onClick={() => setLightboxIndex(i)} />
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={() => handleRemoveExistingPhoto(i)}
                  aria-label="ลบรูปนี้"
                >
                  ×
                </button>
              </div>
            ))}
            {newPhotos.map((p, i) => (
              <div className="photo-thumb" key={`new-${i}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.previewUrl}
                  alt={`รูปใหม่ ${i + 1}`}
                  onClick={() => setLightboxIndex(existingPhotos.length + i)}
                />
                <button
                  type="button"
                  className="photo-remove-btn"
                  onClick={() => handleRemoveNewPhoto(i)}
                  aria-label="ลบรูปนี้"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {photoError && <span style={{ fontSize: 12, color: "#fca5a5" }}>{photoError}</span>}

        {lightboxIndex !== null && (
          <div
            onClick={() => setLightboxIndex(null)}
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
            {allPhotoUrls.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i - 1 + allPhotoUrls.length) % allPhotoUrls.length);
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
              src={allPhotoUrls[lightboxIndex]}
              alt="ขยายรูป"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
            />

            {allPhotoUrls.length > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((i) => (i + 1) % allPhotoUrls.length);
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

            {allPhotoUrls.length > 1 && (
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
                {lightboxIndex + 1} / {allPhotoUrls.length}
              </div>
            )}
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
                car_brand: item.brand_name,
                car_model: item.model_name,
              }));
              setSelectedGeneration(item);
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
          ปีที่ผลิต (ดึงจากฐานข้อมูลอัตโนมัติ — แก้เองไม่ได้)
          <div
            style={{
              padding: 12,
              borderRadius: 8,
              border: "1px solid #333844",
              background: "#14161b",
              color: selectedGeneration ? "#e8e8e8" : "#6b7280",
              fontSize: 14,
            }}
          >
            {selectedGeneration
              ? `${selectedGeneration.year_range_display}${
                  selectedGeneration.generation_code
                    ? ` (${selectedGeneration.generation_code})`
                    : ""
                }`
              : "— ไม่มีข้อมูลปี เลือกรถจากช่องค้นหาด้านบนเพื่ออัปเดต —"}
          </div>
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
            {form.zone_code && !zones.some((z) => z.code === form.zone_code) && (
              <option value={form.zone_code}>{form.zone_code} (ไม่อยู่ในลิสต์แล้ว)</option>
            )}
          </select>
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

      {currentRole !== "assistant" && (
        <button
          type="button"
          onClick={handleDeactivate}
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
          {deleting ? "กำลังดำเนินการ..." : "🗑️ ลบอะไหล่นี้ (ซ่อนจากหน้าแรก)"}
        </button>
      )}
    </div>
  );
}

export default function EditPartPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <EditPartPageContent />
    </RequireAuth>
  );
}
