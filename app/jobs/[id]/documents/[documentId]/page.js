"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../../../lib/supabaseClient";
import { useAuth } from "../../../../../lib/AuthProvider";
import { useTheme } from "../../../../../lib/ThemeProvider";
import RequireAuth from "../../../../../components/RequireAuth";
import CarDamageDiagram from "../../../../../components/CarDamageDiagram";
import SignaturePad from "../../../../../components/SignaturePad";

const CATEGORY_LABELS = { labor: "ค่าแรง", parts: "ค่าอะไหล่", other: "อื่นๆ" };

const DOC_TITLES = {
  receipt: "ใบรับรถ",
  quotation: "ใบเสนอราคา",
  billing: "ใบกำกับภาษี / ใบแจ้งหนี้",
};

const DISCLAIMER_TEXT = `เงื่อนไขการรับฝากรถเพื่อซ่อมแซม/ตรวจสภาพ

1. วัตถุประสงค์ของเอกสาร
เอกสารฉบับนี้ออกให้แก่ลูกค้าเพื่อเป็นหลักฐานว่าลูกค้าได้นำรถเข้ามาจอดไว้ในพื้นที่ของอู่ เพื่อรอดำเนินการซ่อมแซมหรือตรวจสภาพตามรายการที่แจ้งไว้เท่านั้น มิใช่ใบเสร็จรับเงินหรือหลักฐานการชำระเงินแต่อย่างใด

2. ทรัพย์สินภายในรถ
ทางอู่ขอความร่วมมือให้ลูกค้านำทรัพย์สินมีค่าและสิ่งของส่วนตัวออกจากรถก่อนส่งมอบให้อู่ ทางอู่จะไม่รับผิดชอบต่อความสูญหายหรือเสียหายของทรัพย์สินที่หลงเหลืออยู่ภายในรถไม่ว่ากรณีใดๆ ทั้งสิ้น

3. ความเสียหายจากเหตุสุดวิสัยหรือบุคคลภายนอก
อู่จะดูแลรักษารถของลูกค้าตามสมควรระหว่างที่อยู่ในความดูแลของอู่ อย่างไรก็ตาม หากเกิดความเสียหายอันเนื่องมาจากเหตุสุดวิสัย (เช่น อัคคีภัย อุทกภัย ภัยธรรมชาติ) หรือจากการกระทำของบุคคลภายนอกที่อยู่นอกเหนือการควบคุมของอู่ (เช่น การถูกรถคันอื่นเฉี่ยวชน การโจรกรรม) ทางอู่ขอสงวนสิทธิ์พิจารณาข้อเท็จจริงเป็นกรณีไป ว่าจะรับผิดชอบซ่อมแซมความเสียหายดังกล่าวหรือไม่ และอาจส่งเรื่องให้บริษัทประกันภัยที่เกี่ยวข้องเป็นผู้พิจารณารับผิดชอบตามความเหมาะสม

4. การเคลื่อนย้ายรถภายในพื้นที่อู่
อู่มีสิทธิ์เคลื่อนย้ายหรือจัดวางตำแหน่งรถภายในพื้นที่ของอู่ตามความเหมาะสม เพื่อความสะดวกในการปฏิบัติงานหรือการจัดสรรพื้นที่จอดรถ

5. การบันทึกสภาพรถก่อนรับซ่อม
รูปภาพและ/หรือจุดที่มาร์กไว้ในเอกสารนี้ (ถ้ามี) เป็นการบันทึกสภาพรถโดยสังเขป เพื่อใช้อ้างอิงเปรียบเทียบสภาพรถก่อนและหลังการซ่อมเท่านั้น มิได้เป็นการรับรองหรือรับประกันว่าครอบคลุมทุกร่องรอยหรือความเสียหายที่มีอยู่ก่อนแล้วบนตัวรถ

6. ระยะเวลาในการรับรถคืน
เมื่อการซ่อมแซมเสร็จสิ้นและอู่ได้แจ้งให้ลูกค้าทราบแล้ว ขอให้ลูกค้ามารับรถคืนภายในระยะเวลาที่อู่กำหนด หากพ้นกำหนดเวลาดังกล่าว อู่ขอสงวนสิทธิ์ในการเรียกเก็บค่าฝากรถเพิ่มเติมตามอัตราที่อู่กำหนด และจะไม่รับผิดชอบต่อความเสียหายที่อาจเกิดขึ้นกับยาง แบตเตอรี่ หรืออุปกรณ์อื่นใด อันเนื่องมาจากการจอดรถไว้เป็นระยะเวลานานเกินสมควร

ข้าพเจ้าผู้ลงลายมือชื่อด้านล่างนี้ ได้อ่านและเข้าใจเงื่อนไขทั้งหมดที่ระบุไว้ในเอกสารฉบับนี้แล้ว และยินยอมให้นำรถเข้ารับบริการตามเงื่อนไขดังกล่าวทุกประการ`;

function InfoRow({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
      <span style={{ color: "var(--text-muted)", fontSize: 13, flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, textAlign: "right" }}>{value}</span>
    </div>
  );
}

function JobDocumentPageContent() {
  const params = useParams();
  const { currentShopId } = useAuth();
  const { theme } = useTheme();
  const { id: jobId, documentId } = params;

  const [doc, setDoc] = useState(null);
  const [shopInfo, setShopInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingSignature, setSavingSignature] = useState(false);

  useEffect(() => {
    fetchDocument();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  async function handleSaveSignature(blob) {
    setSavingSignature(true);
    try {
      const fileName = `signature-${documentId}-${Date.now()}.png`;
      const { error: uploadError } = await supabase.storage.from("part-photos").upload(fileName, blob);
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from("part-photos").getPublicUrl(fileName);

      const { error: updateError } = await supabase
        .from("job_documents")
        .update({ signature_url: urlData.publicUrl, signed_at: new Date().toISOString() })
        .eq("document_id", documentId);
      if (updateError) throw updateError;

      fetchDocument();
    } catch (err) {
      alert("บันทึกลายเซ็นไม่สำเร็จ: " + err.message);
    } finally {
      setSavingSignature(false);
    }
  }

  async function fetchDocument() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("job_documents")
      .select("*")
      .eq("document_id", documentId)
      .single();

    if (fetchError) {
      setError(fetchError.message);
      setLoading(false);
      return;
    }

    setDoc(data);

    // เอกสารเก่าที่สร้างก่อนอัปเดตนี้อาจไม่มีข้อมูลร้านใน snapshot -> เผื่อไปดึงสดแทน
    if (!data.snapshot?.shop_name) {
      const { data: shop } = await supabase
        .from("shops")
        .select("shop_name, company_name, address, tax_id, phone")
        .eq("shop_id", data.shop_id)
        .maybeSingle();
      setShopInfo(
        shop
          ? { ...shop, shop_name: shop.company_name || shop.shop_name }
          : {}
      );
    } else {
      setShopInfo({
        shop_name: data.snapshot.shop_name,
        address: data.snapshot.shop_address,
        tax_id: data.snapshot.shop_tax_id,
        phone: data.snapshot.shop_phone,
      });
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

  if (error || !doc) {
    return (
      <div className="container">
        <div className="msg error">{error || "ไม่พบเอกสาร"}</div>
      </div>
    );
  }

  const s = doc.snapshot;
  const isBilling = doc.doc_type === "billing";

  return (
    <>
      <div className="container print-area">
        <div className="header no-print">
          <h1>
            {doc.doc_type === "receipt" && "📋 ใบรับรถ"}
            {doc.doc_type === "quotation" && "📄 ใบเสนอราคา"}
            {doc.doc_type === "billing" && "🧾 ใบกำกับภาษี / ใบแจ้งหนี้"}
          </h1>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/jobs/${jobId}`} className="nav-link secondary">
              ← กลับ
            </Link>
            <button
              type="button"
              onClick={() => window.print()}
              className="nav-link"
              style={{ border: "none", cursor: "pointer" }}
            >
              🖨️ พิมพ์ / PDF
            </button>
          </div>
        </div>

        {/* ================= หัวเอกสาร: ข้อมูลร้าน + ชื่อเอกสาร + เลขที่ ================= */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 16,
            paddingBottom: 16,
            marginBottom: 16,
            borderBottom: "2px solid var(--border-strong)",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>
              {shopInfo?.shop_name || "-"}
            </div>
            {shopInfo?.address && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 320 }}>
                {shopInfo.address}
              </div>
            )}
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {shopInfo?.phone && <>โทร. {shopInfo.phone} </>}
              {isBilling && (
                <>
                  {shopInfo?.phone && " · "}
                  เลขประจำตัวผู้เสียภาษี: {shopInfo?.tax_id || "ยังไม่ระบุ"}
                </>
              )}
            </div>
          </div>

          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>
              {DOC_TITLES[doc.doc_type]}
            </div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>เลขที่: {doc.doc_number}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              วันที่ {new Date(doc.created_at).toLocaleDateString("th-TH")}
            </div>
          </div>
        </div>

        {isBilling && !shopInfo?.tax_id && (
          <div className="msg error no-print" style={{ marginBottom: 16 }}>
            ⚠️ ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของร้าน — ใบกำกับภาษีจะไม่สมบูรณ์ตามกฎหมาย
            ไปตั้งค่าได้ที่หน้า{" "}
            <Link href="/admin" style={{ color: "var(--link)" }}>
              ⚙️ ตั้งค่า → ข้อมูลร้าน/อู่
            </Link>
          </div>
        )}

        {/* ================= ข้อมูลลูกค้า + รถ ================= */}
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 20,
          }}
        >
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 700 }}>
              ผู้ซื้อ/ผู้รับบริการ
            </div>
            <InfoRow label="ชื่อ" value={s.customer_name} />
            <InfoRow label="ที่อยู่" value={s.customer_address} />
            <InfoRow label="เบอร์โทร" value={s.customer_phone} />
          </div>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, fontWeight: 700 }}>
              ข้อมูลรถ
            </div>
            <InfoRow
              label="รุ่น"
              value={`${s.car_brand || ""} ${s.car_model || ""} ${
                s.car_year_display ? `(${s.car_year_display})` : ""
              }`.trim()}
            />
            <InfoRow label="ทะเบียน" value={s.license_plate} />
            {s.notes && <InfoRow label="รายการสั่งซ่อม" value={s.notes} />}
          </div>
        </div>

        {doc.doc_type === "receipt" && (
          <>
            <CarDamageDiagram points={s.damage_points || []} carType={s.car_diagram_type || "sedan"} readOnly />
            <div
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 20,
                whiteSpace: "pre-line",
                lineHeight: 1.7,
              }}
            >
              {DISCLAIMER_TEXT}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 24,
                marginTop: 30,
                fontSize: 13,
                flexWrap: "wrap",
              }}
            >
              <div style={{ width: "45%", minWidth: 260 }}>
                {doc.signature_url ? (
                  <div style={{ textAlign: "center" }}>
                    {/* invert สีเฉพาะ dark mode — ลายเซ็น (สีเข้ม, พื้นโปร่งใส) จะกลายเป็นสีขาว
                        มองเห็นชัดบนพื้นเข้ม โดยไม่ต้องมีกล่องขาวครอบให้ดูขัดตา */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={doc.signature_url}
                      alt="ลายเซ็นผู้ยินยอม"
                      style={{
                        maxHeight: 90,
                        marginBottom: 4,
                        filter: theme === "dark" ? "invert(1)" : "none",
                      }}
                    />
                    <div style={{ borderTop: "1px solid var(--text-muted)", paddingTop: 6 }}>
                      ผู้ยินยอม (เจ้าของรถ/ผู้มอบรถ)
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                      เซ็นเมื่อ {new Date(doc.signed_at).toLocaleString("th-TH")}
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, textAlign: "center" }}>
                      ให้ลูกค้าเซ็นชื่อยินยอมที่นี่
                    </div>
                    <SignaturePad onSave={handleSaveSignature} saving={savingSignature} />
                  </div>
                )}
              </div>

              <div style={{ width: "45%", minWidth: 200, textAlign: "center", paddingTop: 6 }}>
                <div style={{ borderTop: "1px solid var(--text-muted)", paddingTop: 6 }}>
                  ผู้รับรถ: {s.received_by_name || "-"}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {new Date(doc.created_at).toLocaleString("th-TH")}
                </div>
              </div>
            </div>
          </>
        )}

        {(doc.doc_type === "quotation" || doc.doc_type === "billing") && (
          <>
            {isBilling ? (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-strong)" }}>
                    <th style={{ textAlign: "left", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      รายการ
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      ปริมาณ
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      ราคา/หน่วย
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      ค่าแรง
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      ค่าอะไหล่
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.cost_items.map((item, i) => {
                    const qty = item.quantity || 1;
                    const unitPrice = Number(item.amount) / qty;
                    return (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "8px 4px" }}>{item.description}</td>
                        <td style={{ padding: "8px 4px", textAlign: "right" }}>{qty}</td>
                        <td style={{ padding: "8px 4px", textAlign: "right" }}>
                          {unitPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: "8px 4px", textAlign: "right" }}>
                          {item.category === "labor" ? Number(item.amount).toLocaleString() : ""}
                        </td>
                        <td style={{ padding: "8px 4px", textAlign: "right" }}>
                          {item.category !== "labor" ? Number(item.amount).toLocaleString() : ""}
                        </td>
                      </tr>
                    );
                  })}
                  <tr style={{ fontWeight: 700 }}>
                    <td style={{ padding: "8px 4px" }} colSpan={3}>
                      รวม
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right" }}>
                      {s.labor_total.toLocaleString()}
                    </td>
                    <td style={{ padding: "8px 4px", textAlign: "right" }}>
                      {s.parts_total.toLocaleString()}
                    </td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 16 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border-strong)" }}>
                    <th style={{ textAlign: "left", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      รายการ
                    </th>
                    <th style={{ textAlign: "left", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      หมวด
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      ปริมาณ
                    </th>
                    <th style={{ textAlign: "right", padding: "8px 4px", fontSize: 12, color: "var(--text-muted)" }}>
                      จำนวนเงิน
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {s.cost_items.map((item, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 4px" }}>{item.description}</td>
                      <td style={{ padding: "8px 4px", color: "var(--text-muted)", fontSize: 13 }}>
                        {CATEGORY_LABELS[item.category]}
                      </td>
                      <td style={{ padding: "8px 4px", textAlign: "right" }}>{item.quantity || 1}</td>
                      <td style={{ padding: "8px 4px", textAlign: "right" }}>
                        {Number(item.amount).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div style={{ maxWidth: 280, marginLeft: "auto", fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ color: "var(--text-muted)" }}>รวมมูลค่าสินค้า/บริการ</span>
                <span>{s.subtotal.toLocaleString()}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ color: "var(--text-muted)" }}>
                  ภาษีมูลค่าเพิ่ม (VAT) {s.vat_type === "vat7" ? "7%" : "— ไม่มี VAT"}
                </span>
                <span>
                  {s.vat_type === "vat7"
                    ? s.vat_amount.toLocaleString(undefined, { maximumFractionDigits: 2 })
                    : "0.00"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderTop: "2px solid var(--border-strong)",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                <span>จำนวนเงินรวมทั้งสิ้น</span>
                <span>{s.grand_total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
            </div>

            {isBilling && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 16, lineHeight: 1.6 }}>
                เอกสารนี้จัดทำขึ้นด้วยระบบคอมพิวเตอร์ ถูกต้องตามมาตรา 86/4 แห่งประมวลรัษฎากร
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 60,
                fontSize: 13,
              }}
            >
              <div style={{ textAlign: "center", width: "45%" }}>
                <div style={{ borderTop: "1px solid var(--text-muted)", paddingTop: 6 }}>
                  ผู้รับบริการ / ผู้ตรวจรับ
                </div>
              </div>
              <div style={{ textAlign: "center", width: "45%" }}>
                <div style={{ borderTop: "1px solid var(--text-muted)", paddingTop: 6 }}>
                  ผู้ออกเอกสาร
                </div>
              </div>
            </div>
          </>
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

export default function JobDocumentPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <JobDocumentPageContent />
    </RequireAuth>
  );
}
