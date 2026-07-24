"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

const RANGES = [
  { key: "today", label: "วันนี้" },
  { key: "week", label: "7 วันล่าสุด" },
  { key: "month", label: "30 วันล่าสุด" },
  { key: "all", label: "ทั้งหมด" },
];

function getRangeStart(rangeKey) {
  const now = new Date();
  if (rangeKey === "today") {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (rangeKey === "week") {
    now.setDate(now.getDate() - 7);
    return now;
  }
  if (rangeKey === "month") {
    now.setDate(now.getDate() - 30);
    return now;
  }
  return null; // all
}

function ReportsPageContent() {
  const { currentShopId } = useAuth();

  const [range, setRange] = useState("month");
  const [loading, setLoading] = useState(true);
  const [partSales, setPartSales] = useState([]);
  const [billingDocs, setBillingDocs] = useState([]);

  useEffect(() => {
    if (currentShopId) fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId, range]);

  async function fetchData() {
    setLoading(true);
    const rangeStart = getRangeStart(range);

    // ✅ ตัดสินใจแล้วในการ์ด Accounting Module — scope "Informal Report": แยกตามวิธีชำระเงินด้วย
    // (payment_method มีอยู่แล้วจาก card เดิม + ตอนนี้ผูกกับ Cart-based selling flow เต็มรูปแล้ว)
    //
    // บั๊กที่แก้คืนนี้: query เดิมไม่กรอง item_status เลย — พอ Cart-based selling flow เริ่มใช้จริง
    // แล้ว part_sales บางแถวจะมี item_status = 'not_found' (พนักงานหาของไม่เจอตอน pick แล้วคืน
    // สต็อกอัตโนมัติ — ดูการ์ด Cart-based selling flow) ซึ่ง**ไม่ควรนับเป็นยอดขายจริง** เพราะสต็อก
    // ถูกคืนแล้วไม่มีการส่งมอบเกิดขึ้นจริง แต่รายงานเดิมนับรวมไปด้วยเพราะไม่เคยกรอง — แก้แล้ว
    let salesQuery = supabase
      .from("part_sales")
      .select("sale_id, quantity_sold, sale_price, sold_to, sold_at, payment_method, item_status, part_id, parts(part_name)")
      .eq("shop_id", currentShopId)
      .neq("item_status", "not_found")
      .order("sold_at", { ascending: false });
    if (rangeStart) salesQuery = salesQuery.gte("sold_at", rangeStart.toISOString());

    let billingQuery = supabase
      .from("job_documents")
      .select("document_id, doc_number, snapshot, created_at, job_id")
      .eq("shop_id", currentShopId)
      .eq("doc_type", "billing")
      .order("created_at", { ascending: false });
    if (rangeStart) billingQuery = billingQuery.gte("created_at", rangeStart.toISOString());

    const [salesRes, billingRes] = await Promise.all([salesQuery, billingQuery]);

    setPartSales(salesRes.data || []);
    setBillingDocs(billingRes.data || []);
    setLoading(false);
  }

  const partSalesTotal = partSales.reduce((sum, s) => sum + Number(s.quantity_sold) * Number(s.sale_price), 0);
  const partSalesQty = partSales.reduce((sum, s) => sum + Number(s.quantity_sold), 0);

  // แยกตามวิธีชำระเงิน (ตัดสินใจแล้วในการ์ด Accounting Module scope "Informal Report")
  const PAYMENT_METHOD_LABELS = { cash: "เงินสด", bank_transfer: "โอนเงิน", card: "บัตร", other: "อื่นๆ" };
  const byPaymentMethod = {};
  partSales.forEach((s) => {
    const key = s.payment_method || "unspecified";
    byPaymentMethod[key] = (byPaymentMethod[key] || 0) + Number(s.quantity_sold) * Number(s.sale_price);
  });

  const billingTotal = billingDocs.reduce((sum, d) => sum + Number(d.snapshot?.grand_total || 0), 0);

  const grandTotal = partSalesTotal + billingTotal;

  // สรุปยอดรายวัน (รวมทั้ง 2 แหล่ง) สำหรับกราฟแท่งง่ายๆ
  const dailyTotals = {};
  partSales.forEach((s) => {
    const day = new Date(s.sold_at).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" });
    dailyTotals[day] = (dailyTotals[day] || 0) + Number(s.quantity_sold) * Number(s.sale_price);
  });
  billingDocs.forEach((d) => {
    const day = new Date(d.created_at).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit" });
    dailyTotals[day] = (dailyTotals[day] || 0) + Number(d.snapshot?.grand_total || 0);
  });
  const dailyEntries = Object.entries(dailyTotals).slice(-14); // ล่าสุด 14 วันที่มีข้อมูล
  const maxDaily = Math.max(1, ...dailyEntries.map(([, v]) => v));

  return (
    <div className="container">
      <div className="header">
        <h1>📊 รายงานการขาย</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      <div className="view-toggle" style={{ marginBottom: 16, width: "100%" }}>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={range === r.key ? "active" : ""}
            onClick={() => setRange(r.key)}
            style={{ flex: 1 }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="empty">กำลังโหลด...</div>
      ) : (
        <>
          {/* สรุปยอดรวม */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ยอดขายรวมทั้งหมด</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{grandTotal.toLocaleString()} บาท</div>
            </div>
            <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ขายอะไหล่ถอด</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{partSalesTotal.toLocaleString()} บาท</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{partSalesQty} ชิ้น</div>
            </div>
            <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start" }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>ยอดใบแจ้งหนี้งานซ่อม</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{billingTotal.toLocaleString()} บาท</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{billingDocs.length} ใบ</div>
            </div>
          </div>

          {/* กราฟแท่งรายวันแบบง่าย */}
          {dailyEntries.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>ยอดขายรายวัน</div>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 6,
                  height: 120,
                  padding: "8px 0",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {dailyEntries.map(([day, total]) => (
                  <div
                    key={day}
                    style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}
                    title={`${day}: ${total.toLocaleString()} บาท`}
                  >
                    <div
                      style={{
                        width: "100%",
                        maxWidth: 24,
                        height: `${Math.max(4, (total / maxDaily) * 90)}px`,
                        background: "#2563eb",
                        borderRadius: "3px 3px 0 0",
                      }}
                    />
                    <div style={{ fontSize: 9, color: "var(--text-muted)", whiteSpace: "nowrap" }}>{day}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* แยกตามวิธีชำระเงิน (Informal Report scope — Accounting Module) */}
          {partSales.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
                ยอดขายอะไหล่ แยกตามวิธีชำระเงิน
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {Object.entries(byPaymentMethod).map(([method, total]) => (
                  <div
                    className="card"
                    key={method}
                    style={{ cursor: "default", flexDirection: "column", alignItems: "flex-start", minWidth: 120 }}
                  >
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {PAYMENT_METHOD_LABELS[method] || "ไม่ระบุ"}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{total.toLocaleString()} บาท</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* รายการขายอะไหล่ถอด */}
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>🔧 รายการขายอะไหล่ถอด</h2>
          {partSales.length === 0 && <div className="empty">ยังไม่มีการขายในช่วงนี้</div>}
          {partSales.map((s) => (
            <div className="card" key={s.sale_id} style={{ cursor: "default" }}>
              <div className="card-body">
                <div className="card-title">{s.parts?.part_name || "-"}</div>
                <div className="card-sub">
                  {s.quantity_sold} ชิ้น × {Number(s.sale_price).toLocaleString()} บาท
                  {s.sold_to && ` — ${s.sold_to}`}
                </div>
                <div className="card-sub" style={{ fontSize: 11 }}>
                  {new Date(s.sold_at).toLocaleString("th-TH")}
                </div>
              </div>
              <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                {(Number(s.quantity_sold) * Number(s.sale_price)).toLocaleString()} บาท
              </div>
            </div>
          ))}

          {/* รายการใบแจ้งหนี้งานซ่อม */}
          <h2 style={{ fontSize: 16, margin: "20px 0 10px" }}>🧾 ใบแจ้งหนี้งานซ่อม</h2>
          {billingDocs.length === 0 && <div className="empty">ยังไม่มีใบแจ้งหนี้ในช่วงนี้</div>}
          {billingDocs.map((d) => (
            <Link
              href={`/jobs/${d.job_id}/documents/${d.document_id}`}
              className="card"
              key={d.document_id}
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="card-body">
                <div className="card-title">
                  {d.snapshot?.car_brand} {d.snapshot?.car_model}
                  {d.snapshot?.license_plate ? ` · ${d.snapshot.license_plate}` : ""}
                </div>
                <div className="card-sub">
                  {d.snapshot?.customer_name || "-"} — เลขที่ {d.doc_number}
                </div>
                <div className="card-sub" style={{ fontSize: 11 }}>
                  {new Date(d.created_at).toLocaleString("th-TH")}
                </div>
              </div>
              <div style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                {Number(d.snapshot?.grand_total || 0).toLocaleString()} บาท
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]} requiredFeature="reports">
      <ReportsPageContent />
    </RequireAuth>
  );
}
