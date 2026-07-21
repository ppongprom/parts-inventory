"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../lib/supabaseClient";
import RequireAuth from "../../components/RequireAuth";
import PartQRCode from "../../components/PartQRCode";
import { formatBreadcrumbShort } from "../../lib/zoneHelpers";

// การ์ด "🌙 งานที่ต้องทำคืนนี้" ข้อ 3 — Part QR spec
// ตัดสินใจ (ไม่มีมติชัดเจนในการ์ด — ตัดสินใจตอนทำจริงเพื่อให้ implement ได้ ระบุเหตุผลไว้):
//  - ขนาดกระดาษ: ใช้ 40x60mm เดียวกับ Zone QR (เครื่องพิมพ์ label เดียวกัน EasyPrint ES-9920UX —
//    ร้านมีสติกเกอร์ขนาดนี้อยู่แล้ว ไม่ต้องซื้อกระดาษเพิ่มอีกขนาด) เดิมใช้ A4 grid ซึ่งใช้งานจริง
//    หน้างานไม่ได้เลย (ต้องตัดกระดาษเอง)
//  - ฟิลด์ที่โชว์: คงเดิม (ชื่ออะไหล่/ยี่ห้อ-รุ่นรถ/โซน/ID 8 หลัก) + เปลี่ยนโซนจาก zone_code เดิม
//    (legacy text ที่ไม่อัปเดตแล้ว) เป็น breadcrumb จริงจาก zone_id ถ้ามี — ไม่เพิ่มราคา (โชว์ราคา
//    บนป้ายติดของบนชั้นเสี่ยงลูกค้าเห็นราคาต้นทุนก่อนคุยจริง) และไม่เพิ่มสภาพ/เลขที่เอกสาร (ป้ายเดิม
//    ไม่มี พื้นที่ 40x60mm จำกัด ของสำคัญกว่าคือหาเจอ/ยืนยันว่าใช่ชิ้นไหน ไม่ใช่รายละเอียดเต็ม)
function PrintLabelsPageContent() {
  const searchParams = useSearchParams();
  const ids = (searchParams.get("ids") || "").split(",").filter(Boolean);

  const [parts, setParts] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchParts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchParts() {
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    const { data } = await supabase.from("parts").select("*").in("id", ids);
    // เรียงตามลำดับ id ที่เลือกไว้ตอนแรก ไม่ใช่ลำดับที่ query คืนมา
    const ordered = ids.map((id) => data?.find((p) => p.id === id)).filter(Boolean);
    setParts(ordered);

    const shopId = ordered[0]?.shop_id;
    if (shopId) {
      const { data: zoneRows } = await supabase.from("zones").select("*").eq("shop_id", shopId);
      setZones(zoneRows || []);
    }
    setLoading(false);
  }

  function zoneLabel(part) {
    if (part.zone_id) {
      const label = formatBreadcrumbShort(zones, part.zone_id, 2);
      if (label) return label;
    }
    return part.zone_code || null;
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังโหลด...</div>
      </div>
    );
  }

  return (
    <>
      <div className="container">
        <div className="header no-print">
          <h1>🏷️ พิมพ์ป้าย QR ({parts.length} ชิ้น)</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/" className="nav-link secondary">
              ← กลับ
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="nav-link"
              style={{ border: "none", cursor: "pointer" }}
            >
              🖨️ พิมพ์ทั้งหมด
            </button>
          </div>
        </div>

        {parts.length === 0 && <div className="empty">ไม่พบอะไหล่ที่เลือก</div>}

        <div className="label-grid">
          {parts.map((part) => (
            <div className="label-card" key={part.id}>
              <PartQRCode partId={part.id} size={110} />
              <div className="label-text">
                <div className="label-title">{part.part_name}</div>
                <div className="label-sub">
                  {part.car_brand} {part.car_model}
                </div>
                {zoneLabel(part) && <div className="label-sub">โซน {zoneLabel(part)}</div>}
                <div className="label-id">#{part.id.slice(0, 8)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .label-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
        }
        .label-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 12px;
          border: 1px dashed var(--border-strong);
          border-radius: 8px;
        }
        .label-text {
          text-align: center;
        }
        .label-title {
          font-weight: 700;
          font-size: 12px;
        }
        .label-sub {
          font-size: 10px;
          color: var(--text-muted);
        }
        .label-id {
          font-size: 9px;
          color: var(--text-muted);
          margin-top: 2px;
          font-family: monospace;
        }

        /* โหมดพิมพ์จริง — เปลี่ยนจาก A4 grid เดิม (ใช้งานหน้างานไม่ได้ ต้องตัดกระดาษเอง) เป็นป้าย
           40 x 60 มม. ทีละดวงต่อหน้า เหมือน Zone QR (เครื่องพิมพ์ label ความร้อนเดียวกัน
           เช่น EasyPrint ES-9920UX — ร้านมีสติกเกอร์ขนาดนี้อยู่แล้ว) */
        @media print {
          .no-print {
            display: none !important;
          }
          body {
            background: white !important;
            color: black !important;
          }
          @page {
            size: 40mm 60mm;
            margin: 2mm;
          }
          .label-grid {
            display: block;
          }
          .label-card {
            width: 100%;
            height: 100%;
            box-sizing: border-box;
            border: none !important;
            border-radius: 0;
            padding: 0;
            justify-content: center;
            page-break-after: always;
            break-after: page;
          }
          .label-card:last-child {
            page-break-after: auto;
            break-after: auto;
          }
          .label-card canvas {
            width: 26mm !important;
            height: 26mm !important;
          }
          .label-title {
            font-size: 13pt;
            font-weight: 800;
            color: black !important;
          }
          .label-sub,
          .label-id {
            font-size: 8pt;
            color: black !important;
          }
        }
      `}</style>
    </>
  );
}

export default function PrintLabelsPage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="container">กำลังโหลด...</div>}>
        <PrintLabelsPageContent />
      </Suspense>
    </RequireAuth>
  );
}
