"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import { SESSION_ID_HEADER, getStoredSessionId } from "../../../lib/sessionTracking";

// Card: "รายงานสรุปสต็อก (Stock Summary Report) — Pro+" (Notion 3a1f39f4564981d1a15ed167dcd8031b)
//
// Role gate matches app/admin/reports/page.js exactly (owner/manager only). Tier gate (Pro+) is
// enforced server-side at app/api/reports/stock-summary/route.js — this page just calls that API
// and shows its 403 message if the shop isn't eligible, same "UI-hide + API 403, always both
// layers" convention already used for the /admin hub link (see app/admin/page.js
// canSeeStockSummaryReport) and app/api/sales/export-csv/route.js.
//
// Real-time only report (no month-end snapshot) — matches the Stock Value Cap Engine itself.

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
    [SESSION_ID_HEADER]: getStoredSessionId() || "",
  };
}

function money(n) {
  return Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

const VEHICLE_STATUS_LABELS = {
  in_stock: "ยังไม่ถอด",
  disassembling: "กำลังถอด",
  fully_disassembled: "ถอดหมดแล้ว",
  sold_whole: "ขายทั้งคัน",
};

function StockSummaryReportContent() {
  const { currentShopId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [topSellersDays, setTopSellersDays] = useState(30);

  useEffect(() => {
    if (currentShopId) fetchReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId, topSellersDays]);

  async function fetchReport() {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch(
        `/api/reports/stock-summary?shop_id=${currentShopId}&days=${topSellersDays}`,
        { headers }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "โหลดรายงานไม่สำเร็จ");
        setReport(null);
      } else {
        setReport(data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>📦 รายงานสรุปสต็อก</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && error && (
        <div className="msg error" data-testid="stock-summary-error">
          {error}
        </div>
      )}

      {!loading && !error && report && (
        <>
          <div className="msg" style={{ marginBottom: 16 }} data-testid="live-only-note">
            ⏱️ {report.liveOnlyNote}
          </div>

          {/* ข้อ 1 — On-balance-sheet stock value */}
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>
            1) มูลค่าสต็อกที่ขึ้นงบบริษัทจริง (On-balance-sheet)
          </h2>
          <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }} data-testid="section1-total">
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>มูลค่ารวม</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(report.section1.total)} บาท</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              อะไหล่ (ซื้อตรง + ถอดจากซาก): {money(report.section1.partsValue)} บาท · ซากรถยังถอดไม่หมด:{" "}
              {money(report.section1.remainingVehicleValue)} บาท
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10, marginBottom: 20 }}>
            {["byZone", "byBrand", "byCondition"].map((key) => (
              <div key={key} style={{ minWidth: 220 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
                  {key === "byZone" ? "แยกตามโซน" : key === "byBrand" ? "แยกตามยี่ห้อ" : "แยกตามสภาพ"}
                </div>
                {(report.section1.breakdown[key] || []).length === 0 && (
                  <div className="empty" style={{ padding: 8 }}>
                    ไม่มีข้อมูล
                  </div>
                )}
                {(report.section1.breakdown[key] || []).map((row) => (
                  <div key={row.label} className="card-sub" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{row.label}</span>
                    <span>{money(row.value)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {/* ข้อ 2 — off-balance / consignment */}
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>2) มูลค่าของฝากขาย (Off-balance-sheet — memo)</h2>
          <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }} data-testid="section2-total">
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>มูลค่ารวม (ไม่รวมในข้อ 1)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{money(report.section2.total)} บาท</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{report.section2.note}</div>
          </div>
          <div style={{ marginBottom: 20, marginTop: 10 }}>
            {report.section2.byOwnerType.length === 0 && <div className="empty">ไม่มีของฝากขาย</div>}
            {report.section2.byOwnerType.map((row) => (
              <div key={row.ownerType} className="card-sub" style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{row.ownerType}</span>
                <span>{money(row.value)}</span>
              </div>
            ))}
          </div>

          {/* ข้อ 3 — สถานะซากรถ */}
          <h2 style={{ fontSize: 16, marginBottom: 8 }}>3) สถานะซากรถ</h2>
          {report.section3.length === 0 && (
            <div className="empty" data-testid="section3-empty">
              ร้านนี้ยังไม่มีซากรถเลย
            </div>
          )}
          {report.section3.map((v) => (
            <div className="card" key={v.vehicleId} style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }}>
              <div className="card-title">
                ซากรถ #{v.vehicleId} — {VEHICLE_STATUS_LABELS[v.status] || v.status}
              </div>
              <div className="card-sub">ราคาซื้อ: {money(v.purchasePrice)} บาท</div>
              <div className="card-sub">ยอดขายสะสม: {money(v.cumulativeRevenue)} บาท</div>
              <div className="card-sub">ต้นทุนที่รับรู้แล้ว (เฉพาะชิ้นที่ขายแล้ว): {money(v.costRecognized)} บาท</div>
              <div style={{ fontWeight: 700 }}>กำไรสะสม: {money(v.profit)} บาท</div>
            </div>
          ))}

          {/* ข้อ 4 — ค้างสต็อกนาน */}
          <h2 style={{ fontSize: 16, margin: "20px 0 8px" }}>4) อะไหล่/ซากค้างสต็อกนาน</h2>
          <div className="msg" style={{ marginBottom: 10 }}>
            เกณฑ์ปัจจุบัน: ค้างเกิน {report.section4.thresholdDays} วันไม่เคยขาย — {report.section4.thresholdNote}
          </div>
          {report.section4.items.length === 0 && <div className="empty">ไม่มีอะไหล่ค้างสต็อกนาน</div>}
          {report.section4.items.map((item) => (
            <div className="card" key={item.partId} style={{ cursor: "default" }}>
              <div className="card-body">
                <div className="card-title">{item.partName}</div>
                <div className="card-sub">
                  {item.carBrand || "-"} · {item.condition || "-"} · {item.origin === "salvage" ? "จากซาก" : "ซื้อตรง"}
                </div>
              </div>
              <div style={{ fontWeight: 700 }}>{money(item.costValue)} บาท</div>
            </div>
          ))}

          {/* ข้อ 5 — Top 10 */}
          <h2 style={{ fontSize: 16, margin: "20px 0 8px" }}>5) Top 10 อะไหล่ขายดี/ขายช้า</h2>
          <div style={{ marginBottom: 10 }}>
            <label>
              ช่วงเวลา (วัน):{" "}
              <input
                type="number"
                min={1}
                value={topSellersDays}
                onChange={(e) => setTopSellersDays(Number(e.target.value) || 30)}
                style={{ width: 80 }}
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>ขายดี</div>
              {report.section5.topSellers.length === 0 && <div className="empty">ไม่มีข้อมูล</div>}
              {report.section5.topSellers.map((s) => (
                <div key={s.partId} className="card-sub" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.partName || s.partId}</span>
                  <span>{s.qtySold} ชิ้น</span>
                </div>
              ))}
            </div>
            <div style={{ minWidth: 260 }}>
              <div style={{ fontSize: 13, marginBottom: 6 }}>ขายช้า</div>
              {report.section5.slowSellers.length === 0 && <div className="empty">ไม่มีข้อมูล</div>}
              {report.section5.slowSellers.map((s) => (
                <div key={s.partId} className="card-sub" style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{s.partName || s.partId}</span>
                  <span>{s.qtySold} ชิ้น</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function StockSummaryReportPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "admin"]}>
      <StockSummaryReportContent />
    </RequireAuth>
  );
}
