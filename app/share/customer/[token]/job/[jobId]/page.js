"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

const STATUS_LABELS = {
  received: "รับเรื่องแล้ว",
  in_progress: "กำลังซ่อม",
  waiting_parts: "รออะไหล่",
  completed: "ซ่อมเสร็จแล้ว",
  delivered: "ส่งมอบแล้ว",
  canceled: "ยกเลิก",
};

const CATEGORY_LABELS = {
  labor: "ค่าแรง",
  parts: "ค่าอะไหล่",
  other: "อื่นๆ",
};

const STEP_STATUS_LABELS = {
  pending: "⏳ รอเริ่ม",
  in_progress: "🔧 กำลังทำ",
  on_hold: "⏸️ หยุดชั่วคราว",
  done: "✅ เสร็จแล้ว",
  skipped: "⏭️ ข้าม",
};

const STEP_PHOTO_CATEGORIES = [
  { key: "general", label: "สภาพทั่วไป" },
  { key: "before", label: "ก่อนเปลี่ยน/แก้ไข" },
  { key: "after", label: "หลังเปลี่ยน/แก้ไข" },
];

export default function CustomerJobDetailPage() {
  const params = useParams();
  const { token, jobId } = params;

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lightboxPhotos, setLightboxPhotos] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  function openLightbox(photos, index) {
    setLightboxPhotos(photos);
    setLightboxIndex(index);
  }

  function closeLightbox() {
    setLightboxIndex(null);
    setLightboxPhotos(null);
  }

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, jobId]);

  async function fetchData() {
    setLoading(true);
    const res = await fetch(`/api/public/customer/${token}/job/${jobId}`);
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "เกิดข้อผิดพลาด");
    } else {
      setData(json.data);
    }
    setLoading(false);
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังโหลด...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="msg error">{error}</div>
        <Link href={`/share/customer/${token}`} className="nav-link secondary" style={{ marginTop: 16, display: "inline-block" }}>
          ← กลับไปดูรายการทั้งหมด
        </Link>
      </div>
    );
  }

  const { job, cost_items, total, shop_name, customer_name, workflow_steps } = data;

  return (
    <>
      <div className="container print-area">
        <div className="header no-print">
          <h1>🧾 ใบสรุปค่าใช้จ่าย</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/share/customer/${token}`} className="nav-link secondary">
              ← กลับ
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="nav-link"
              style={{ border: "none", cursor: "pointer" }}
            >
              🖨️ พิมพ์ / บันทึกเป็น PDF
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, marginBottom: 4 }}>{shop_name}</h2>
          <div style={{ color: "var(--text-muted)", fontSize: 14 }}>ลูกค้า: {customer_name || "-"}</div>
        </div>

        <div
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)" }}>รถ</span>
            <span>
              {job.car_brand} {job.car_model} {job.car_year_display ? `(${job.car_year_display})` : ""}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)" }}>ทะเบียน</span>
            <span>{job.license_plate || "-"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)" }}>สถานะ</span>
            <span>{STATUS_LABELS[job.status] || job.status}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--text-muted)" }}>รับเข้าเมื่อ</span>
            <span>{new Date(job.created_at).toLocaleDateString("th-TH")}</span>
          </div>
          {job.closed_at && (
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>ปิดงานเมื่อ</span>
              <span>{new Date(job.closed_at).toLocaleDateString("th-TH")}</span>
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 10 }}>รายการค่าใช้จ่าย</h3>

        {cost_items.length === 0 && (
          <div className="empty" style={{ padding: 16 }}>
            ยังไม่มีรายการค่าใช้จ่าย
          </div>
        )}

        {cost_items.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border-strong)" }}>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  รายการ
                </th>
                <th style={{ textAlign: "left", padding: "8px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  หมวด
                </th>
                <th style={{ textAlign: "right", padding: "8px 0", fontSize: 13, color: "var(--text-muted)" }}>
                  จำนวนเงิน
                </th>
              </tr>
            </thead>
            <tbody>
              {cost_items.map((item) => (
                <tr key={item.item_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 0" }}>{item.description}</td>
                  <td style={{ padding: "10px 0", color: "var(--text-muted)", fontSize: 13 }}>
                    {CATEGORY_LABELS[item.category] || item.category}
                  </td>
                  <td style={{ padding: "10px 0", textAlign: "right" }}>
                    {Number(item.amount).toLocaleString()} บาท
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 18,
            fontWeight: 700,
            borderTop: "2px solid var(--border-strong)",
            paddingTop: 12,
          }}
        >
          <span>รวมทั้งสิ้น</span>
          <span>{Number(total).toLocaleString()} บาท</span>
        </div>

        {job.photo_urls?.length > 0 && (
          <div className="no-print" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>รูปสภาพรถตอนรับเข้า</h3>
            <div className="photo-thumb-row">
              {job.photo_urls.map((url, i) => (
                <div className="photo-thumb" key={i}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`รูป ${i + 1}`}
                    onClick={() => openLightbox(job.photo_urls, i)}
                    style={{ cursor: "zoom-in" }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* การ์ด "รูปหลักฐานต่อขั้นตอนงาน" — ให้ลูกค้าติดตามสถานะซ่อมทีละขั้นตอน พร้อมหลักฐาน
           ภาพก่อน-หลังเปลี่ยน/แก้ไข เป็นจุดประสงค์หลักของหน้าแชร์นี้ */}
        {workflow_steps?.length > 0 && (
          <div className="no-print" style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 15, marginBottom: 10 }}>ความคืบหน้าการซ่อม</h3>
            {workflow_steps.map((step, index) => (
              <div
                key={step.step_id}
                style={{
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>
                    {index + 1}. {step.step_name}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {STEP_STATUS_LABELS[step.status] || step.status}
                  </span>
                </div>
                {STEP_PHOTO_CATEGORIES.map((cat) => {
                  const urls = step.photos?.[cat.key] || [];
                  if (!urls.length) return null;
                  return (
                    <div key={cat.key} style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>{cat.label}</div>
                      <div className="photo-thumb-row">
                        {urls.map((url, i) => (
                          <div className="photo-thumb" key={i}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`${cat.label} ${i + 1}`}
                              onClick={() => openLightbox(urls, i)}
                              style={{ cursor: "zoom-in" }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {lightboxIndex !== null && lightboxPhotos?.length > 0 && (
          <div
            className="no-print"
            onClick={closeLightbox}
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
              src={lightboxPhotos[lightboxIndex]}
              alt="ขยายรูป"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 8, objectFit: "contain" }}
            />
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          .print-area {
            color: black !important;
          }
          .print-area * {
            color: black !important;
            border-color: #ccc !important;
          }
        }
      `}</style>
    </>
  );
}
