"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import ZoneAutocomplete from "../../../components/ZoneAutocomplete";
import ZoneQRScanner from "../../../components/ZoneQRScanner";
import { formatBreadcrumb } from "../../../lib/zoneHelpers";

// การ์ด "ย้ายอะไหล่ระหว่าง Zone — action ใหม่ พร้อม owner_type override checkbox"
// ขอบเขต: ย้ายทีละชิ้น ภายในสาขาเดียวกันเท่านั้น (ข้ามสาขา = การ์ด "โอนอะไหล่ข้ามสาขา" ต่างหาก)
// เข้าถึงจากปุ่ม "📍 ย้าย Zone" ที่หน้า /edit/[id] — แยกจากการแก้ zone_id ตรงๆ ในฟอร์มแก้ไขทั่วไป
// เพราะมี owner_type mismatch check ที่ฟอร์มแก้ไขปกติไม่มี
//
// Log การย้าย: ไม่สร้างตาราง part_zone_moves แยก — ใช้ audit_log กลางที่มีอยู่แล้ว (trg_audit_parts)
// ซึ่งบันทึก zone_id/owner_type_override เก่า-ใหม่ + ผู้ทำ + เวลาอัตโนมัติทุกครั้งที่ UPDATE parts
// อยู่แล้ว (ดูปุ่ม "ประวัติการแก้ไข" ที่หน้า /edit/[id])

const OWNER_TYPE_LABELS = {
  own: "ของร้านเอง",
  consignment: "ฝากขาย",
  investor: "นักลงทุนร่วม",
};

function MovePartPageContent() {
  const params = useParams();
  const router = useRouter();
  const { id: partId } = params;
  const { currentShopId } = useAuth();

  const [part, setPart] = useState(null);
  const [zones, setZones] = useState([]);
  const [forceZoneScan, setForceZoneScan] = useState(false);
  const [loading, setLoading] = useState(true);
  const [destZoneId, setDestZoneId] = useState(null);
  const [overrideChecked, setOverrideChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (currentShopId && partId) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId, partId]);

  async function load() {
    setLoading(true);
    const [{ data: partRow }, { data: zoneRows }, { data: shopRow }] = await Promise.all([
      supabase.from("parts").select("*").eq("id", partId).eq("shop_id", currentShopId).single(),
      supabase.from("zones").select("*").eq("shop_id", currentShopId).order("code", { ascending: true }),
      supabase.from("shops").select("force_zone_scan_confirmation").eq("shop_id", currentShopId).single(),
    ]);
    setPart(partRow || null);
    setZones(zoneRows || []);
    setForceZoneScan(!!shopRow?.force_zone_scan_confirmation);
    setLoading(false);
  }

  const currentZone = part?.zone_id ? zones.find((z) => z.id === part.zone_id) : null;
  const currentEffectiveOwnerType = part?.owner_type_override || currentZone?.owner_type || null;
  const destZone = destZoneId ? zones.find((z) => z.id === destZoneId) : null;
  const ownerTypeMismatch =
    !!destZone?.owner_type && !!currentEffectiveOwnerType && destZone.owner_type !== currentEffectiveOwnerType;

  async function handleConfirm() {
    if (!destZoneId) return;
    setSaving(true);
    setMsg(null);

    const updates = { zone_id: destZoneId };
    // ✅ ตัดสินใจแล้วในการ์ด (19 ก.ค. 2026): owner_type ไม่ตรง -> ติ๊กยืนยันว่ายังเป็นประเภทเดิม
    // (เขียน override ทับ) หรือไม่ติ๊ก -> รับ owner_type ของโซนใหม่ไปเลย (เคลียร์ override)
    updates.owner_type_override = ownerTypeMismatch && overrideChecked ? currentEffectiveOwnerType : null;

    const { error } = await supabase.from("parts").update(updates).eq("id", partId).eq("shop_id", currentShopId);

    if (error) {
      setMsg({ type: "error", text: "ย้ายไม่สำเร็จ: " + error.message });
    } else {
      setMsg({ type: "success", text: "ย้าย Zone เรียบร้อยแล้ว ✅" });
      setPart((p) => ({ ...p, ...updates }));
      setDestZoneId(null);
      setOverrideChecked(false);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="container">
        <div className="empty">กำลังโหลด...</div>
      </div>
    );
  }

  if (!part) {
    return (
      <div className="container">
        <div className="empty">ไม่พบอะไหล่ชิ้นนี้</div>
        <Link href="/" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="header">
        <h1>📍 ย้าย Zone — {part.part_name}</h1>
        <Link href={`/edit/${partId}`} className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <div style={{ fontSize: 13, marginBottom: 16 }}>
        ตำแหน่งปัจจุบัน:{" "}
        {part.zone_id ? formatBreadcrumb(zones, part.zone_id) : part.zone_code || "ยังไม่มีโซน"}
        {currentEffectiveOwnerType && (
          <span className="tag" style={{ marginLeft: 8 }}>
            {OWNER_TYPE_LABELS[currentEffectiveOwnerType]}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>โซนปลายทาง</div>
        {!forceZoneScan && <ZoneAutocomplete zones={zones} value={destZoneId} onChange={setDestZoneId} />}
        <ZoneQRScanner zones={zones} onScan={setDestZoneId} />
        {forceZoneScan && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            ร้านนี้ตั้งค่าบังคับสแกน QR ยืนยันตำแหน่ง — พิมพ์ค้นหาเองไม่ได้ ต้องสแกนเท่านั้น
          </div>
        )}
        {destZoneId && (
          <div data-testid="dest-zone-label" style={{ fontSize: 13 }}>
            ปลายทาง: {formatBreadcrumb(zones, destZoneId)}
            {destZone?.owner_type && (
              <span className="tag" style={{ marginLeft: 8 }}>
                {OWNER_TYPE_LABELS[destZone.owner_type]}
              </span>
            )}
          </div>
        )}
      </div>

      {ownerTypeMismatch && (
        <label
          data-testid="owner-type-override-checkbox"
          style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 16, fontSize: 13 }}
        >
          <input
            type="checkbox"
            checked={overrideChecked}
            onChange={(e) => setOverrideChecked(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            ของนี้ยังเป็น &quot;{OWNER_TYPE_LABELS[currentEffectiveOwnerType]}&quot; เดิม แม้ย้ายมาโซน
            &quot;{OWNER_TYPE_LABELS[destZone.owner_type]}&quot; นี้ (ไม่ติ๊ก = เปลี่ยนเป็น
            &quot;{OWNER_TYPE_LABELS[destZone.owner_type]}&quot; ตามโซนใหม่)
          </span>
        </label>
      )}

      <button type="button" onClick={handleConfirm} disabled={!destZoneId || saving}>
        {saving ? "กำลังย้าย..." : "ยืนยันย้าย"}
      </button>
    </div>
  );
}

export default function MovePartPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]}>
      <MovePartPageContent />
    </RequireAuth>
  );
}
