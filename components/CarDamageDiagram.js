"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/ThemeProvider";

// ประเภทรถที่มีชุดภาพให้เลือก — เพิ่มได้เรื่อยๆ ทีหลังแค่เติมชุดรูปใหม่ที่นี่
const CAR_TYPES = [
  { key: "sedan", label: "ซีดาน" },
  { key: "uluxury-sedan", label: "Luxury ซีดาน" },
  { key: "suv", label: "SUV" },
  { key: "estima", label: "Estima / MPV" },
  { key: "pickup2d", label: "กระบะ 2 ประตู" },
  { key: "pickup4d", label: "กระบะ 4 ประตู" },
  { key: "toyota-commuter", label: "รถตู้" },
];

const VIEW_DEFS = [
  { key: "front", label: "หน้ารถ" },
  { key: "top", label: "หลังคารถ" },
  { key: "back", label: "หลังรถ" },
  { key: "left", label: "ด้านซ้าย" },
  { key: "right", label: "ด้านขวา" },
];

function getViews(carType) {
  return VIEW_DEFS.map((v) => ({ ...v, image: `/car-diagrams/${carType}-${v.key}.png` }));
}

// งานเก่าที่เคยมาร์กไว้ตอนยังใช้ 3 มุม (front/side/back) — "side" ไม่มีแล้ว
// ให้ fallback ไปโชว์ที่ "left" แทน กันจุดเก่าหายไปเฉยๆ
function normalizeView(view) {
  if (view === "side") return "left";
  return view;
}

export default function CarDamageDiagram({
  points = [],
  onChange,
  readOnly = false,
  carType: carTypeProp,
  onCarTypeChange,
}) {
  const { theme } = useTheme();
  const [localCarType, setLocalCarType] = useState(carTypeProp || "sedan");
  const carType = carTypeProp ?? localCarType;

  function handleCarTypeChange(newType) {
    if (onCarTypeChange) onCarTypeChange(newType);
    else setLocalCarType(newType);
  }

  const [activeView, setActiveView] = useState("front");
  const [pendingNote, setPendingNote] = useState(null); // { view, x, y }
  const noteInputRef = useRef(null);

  // Focus แบบไม่ scroll — autoFocus ปกติของ browser จะ scroll-into-view เอง
  // ซึ่งบางเคสคำนวณตำแหน่งเพี้ยนแล้วเด้งหน้าจอกลับขึ้นบนสุดแทน
  useEffect(() => {
    if (pendingNote && noteInputRef.current) {
      noteInputRef.current.focus({ preventScroll: true });
    }
  }, [pendingNote?.view, pendingNote?.x, pendingNote?.y]);

  const VIEWS = getViews(carType);
  const normalizedPoints = points.map((p) => ({ ...p, view: normalizeView(p.view) }));

  function handleClick(e, view) {
    if (readOnly || !onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setPendingNote({ view, x, y });
  }

  function confirmNote(note) {
    if (!note) return;
    onChange([...points, { view: note.view, x: note.x, y: note.y, note: note.text || "" }]);
    setPendingNote(null);
  }

  function removePoint(index) {
    if (readOnly || !onChange) return;
    onChange(points.filter((_, i) => i !== index));
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {!readOnly && (
        <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
          {CAR_TYPES.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => handleCarTypeChange(c.key)}
              style={{
                padding: "6px 12px",
                borderRadius: 20,
                border: "1px solid var(--border-strong)",
                background: carType === c.key ? "#0f766e" : "var(--surface)",
                color: carType === c.key ? "white" : "var(--text-muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              🚗 {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="no-print" style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setActiveView(v.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: activeView === v.key ? "#2563eb" : "var(--surface)",
              color: activeView === v.key ? "white" : "var(--text-muted)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* ตอนพิมพ์ (readOnly) โชว์ทั้ง 5 มุมพร้อมกันเลย ไม่ต้องสลับแท็บ */}
      <div
        style={{
          display: readOnly ? "grid" : "block",
          gridTemplateColumns: readOnly ? "repeat(3, 1fr)" : undefined,
          gap: 12,
        }}
      >
        {(readOnly ? VIEWS : VIEWS.filter((v) => v.key === activeView)).map((v) => (
          <div key={v.key}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginBottom: 4 }}>
              {v.label}
            </div>
            <div
              onClick={(e) => handleClick(e, v.key)}
              style={{
                position: "relative",
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                overflow: "hidden",
                cursor: readOnly ? "default" : "crosshair",
                background: theme === "dark" ? "black" : "white",
              }}
            >
              {/* รูปเป็นเส้นขาว-ดำล้วน (พื้นขาว เส้นดำ) — ตอน dark theme invert สีทั้งภาพ
                  ได้พื้นดำเส้นขาวพอดี ไม่ต้องสร้างไฟล์รูปแยกชุดที่ 2 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={v.image}
                alt={v.label}
                style={{ width: "100%", display: "block", filter: theme === "dark" ? "invert(1)" : "none" }}
                draggable={false}
              />
              {normalizedPoints
                .filter((p) => p.view === v.key)
                .map((p, i) => (
                  <div
                    key={i}
                    title={p.note}
                    style={{
                      position: "absolute",
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      transform: "translate(-50%, -50%)",
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      background: "#ef4444",
                      border: "2px solid white",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
                    }}
                  />
                ))}
              {/* preview จุดที่กำลังจะมาร์ก (ยังไม่ยืนยัน) — สีเหลือง/ส้ม แยกจากจุดที่บันทึกแล้ว (แดง) */}
              {pendingNote && pendingNote.view === v.key && (
                <div
                  style={{
                    position: "absolute",
                    left: `${pendingNote.x * 100}%`,
                    top: `${pendingNote.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "rgba(245, 158, 11, 0.35)",
                    border: "2px dashed #f59e0b",
                    boxShadow: "0 0 0 1px rgba(0,0,0,0.3)",
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>

      {pendingNote && (
        <div className="no-print" style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="หมายเหตุจุดนี้ (เช่น รอยบุบ, รอยขีดข่วน)"
            ref={noteInputRef}
            onChange={(e) => setPendingNote((n) => ({ ...n, text: e.target.value }))}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            onClick={() => confirmNote(pendingNote)}
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
            มาร์ก
          </button>
        </div>
      )}

      {!readOnly && points.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {normalizedPoints.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <span>
                {VIEWS.find((v) => v.key === p.view)?.label} — {p.note || "ไม่มีหมายเหตุ"}
              </span>
              <button
                type="button"
                onClick={() => removePoint(i)}
                style={{ border: "none", background: "none", color: "var(--danger-text)", cursor: "pointer" }}
              >
                ลบ
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

