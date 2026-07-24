"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import RequireAuth from "../../components/RequireAuth";
import { useTheme } from "../../lib/ThemeProvider";
import { useAuth } from "../../lib/AuthProvider";
import { supabase } from "../../lib/supabaseClient";

function ChangePinCard() {
  const { currentShop } = useAuth();
  const [newPin, setNewPin] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // การ์ดนี้แสดงเฉพาะบัญชีที่ login ด้วย username+PIN เท่านั้น
  // (owner/manager ที่ login ด้วยอีเมลจริงไม่มี login_username เลยไม่เห็นการ์ดนี้)
  if (!currentShop?.login_username) return null;

  async function handleChangePin(e) {
    e.preventDefault();
    if (!newPin.trim()) return;

    setSaving(true);
    setMsg(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/team/reset-pin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          member_id: currentShop.member_id,
          new_pin: newPin.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "เกิดข้อผิดพลาด");

      setMsg({ type: "success", text: "เปลี่ยน PIN สำเร็จ ✅ ใช้ PIN ใหม่ตั้งแต่ครั้งหน้าที่ login" });
      setNewPin("");
    } catch (err) {
      setMsg({ type: "error", text: "เปลี่ยนไม่สำเร็จ: " + err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
      <div className="card-body" style={{ marginBottom: 10 }}>
        <div className="card-title">🔑 เปลี่ยน PIN ของฉัน</div>
        <div className="card-sub">
          Username: {currentShop.login_username} — ตั้ง PIN/รหัสผ่านใหม่ได้เอง (ตัวอักษร+ตัวเลขผสมได้ ยาว 6-20 ตัว)
        </div>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 10 }}>{msg.text}</div>}

      <form onSubmit={handleChangePin} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={newPin}
          onChange={(e) => setNewPin(e.target.value)}
          placeholder="PIN ใหม่"
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          disabled={saving}
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
          {saving ? "กำลังบันทึก..." : "เปลี่ยน PIN"}
        </button>
      </form>
    </div>
  );
}

function ShopInfoCard() {
  const { currentShopId, currentShop } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!currentShopId) return;
    supabase
      .from("shops")
      .select("company_name, address, tax_id, phone")
      .eq("shop_id", currentShopId)
      .single()
      .then(({ data }) => {
        if (data) {
          setCompanyName(data.company_name || "");
          setAddress(data.address || "");
          setTaxId(data.tax_id || "");
          setPhone(data.phone || "");
        }
        setLoaded(true);
      });
  }, [currentShopId]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);

    const { data, error } = await supabase
      .from("shops")
      .update({ company_name: companyName, address, tax_id: taxId, phone })
      .eq("shop_id", currentShopId)
      .select();

    if (error) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + error.message });
    } else if (!data || data.length === 0) {
      // update ผ่านแต่ไม่มีแถวไหนถูกแก้จริง (RLS บล็อกเงียบๆ) — กันเคสนี้ไม่ให้หลอกว่าสำเร็จ
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: ไม่มีสิทธิ์แก้ไขข้อมูลนี้ (ติดต่อผู้ดูแลระบบ)" });
    } else {
      setMsg({ type: "success", text: "บันทึกแล้ว ✅" });
    }
    setSaving(false);
  }

  if (!loaded) return null;

  return (
    <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
      <div className="card-body" style={{ marginBottom: 10 }}>
        <div className="card-title">🏢 ข้อมูลร้าน/อู่ (สำหรับออกเอกสาร)</div>
        <div className="card-sub">
          ใช้พิมพ์ในใบรับรถ/ใบเสนอราคา/ใบแจ้งหนี้ — เลขผู้เสียภาษีจำเป็นสำหรับใบกำกับภาษีตามกฎหมาย
        </div>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 10 }}>{msg.text}</div>}

      <form onSubmit={handleSave}>
        <label>
          ชื่อบริษัท (สำหรับพิมพ์บนเอกสาร)
          <input
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder={`ถ้าไม่กรอก จะใช้ชื่ออู่ "${currentShop?.shop_name || ""}" แทน`}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            เช่น ชื่อจดทะเบียนนิติบุคคล (&quot;บริษัท ... จำกัด&quot;) ถ้าต่างจากชื่ออู่ที่ใช้เรียกกันประจำวัน —
            ชื่ออู่ (แสดงในเมนูด้านข้าง) ยังคงเป็น &quot;{currentShop?.shop_name}&quot; เหมือนเดิม ไม่เปลี่ยน
          </div>
        </label>
        <label>
          ที่อยู่ร้าน/อู่
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="เช่น 123 ถ.สุขุมวิท แขวง... เขต... กรุงเทพฯ 10110"
          />
        </label>
        <label>
          เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)
          <input
            type="text"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="เช่น 0123456789012"
            maxLength={13}
          />
        </label>
        <label>
          เบอร์โทรร้าน
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="เช่น 02-123-4567" />
        </label>
        <button type="submit" disabled={saving}>
          {saving ? "กำลังบันทึก..." : "บันทึกข้อมูลร้าน"}
        </button>
      </form>
    </div>
  );
}

// การ์ด "Export CSV (Starter+)" — เดิมมีแค่ Parts เพราะตอนนั้น payment_method/cart flow ยังไม่มี
// (ดูหมายเหตุใน app/api/parts/export-csv/route.js) — เพิ่ม Jobs/Sales ตาม field spec ที่การ์ด
// ออกแบบไว้แล้ว (19 ก.ค. 2026) คืนนี้ — ใช้ endpoint คนละตัว ปุ่มคนละอันในการ์ดเดียวกัน
const EXPORT_TARGETS = [
  { key: "parts", label: "อะไหล่", endpoint: "/api/parts/export-csv", filenamePrefix: "parts-export" },
  { key: "jobs", label: "งานซ่อม", endpoint: "/api/jobs/export-csv", filenamePrefix: "jobs-export" },
  { key: "sales", label: "การขาย", endpoint: "/api/sales/export-csv", filenamePrefix: "sales-export" },
];

function ExportCsvCard() {
  const { currentShopId } = useAuth();
  const [exportingKey, setExportingKey] = useState(null);
  const [msg, setMsg] = useState(null);

  async function handleExport(target) {
    setExportingKey(target.key);
    setMsg(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch(`${target.endpoint}?shop_id=${currentShopId}`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Export ไม่สำเร็จ");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${target.filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setExportingKey(null);
    }
  }

  return (
    <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
      <div className="card-body" style={{ marginBottom: 10 }}>
        <div className="card-title">📤 Export CSV</div>
        <div className="card-sub">
          ดาวน์โหลดข้อมูลเป็นไฟล์ CSV (เปิดด้วย Excel ได้ ไม่มีปัญหาภาษาไทยเพี้ยน)
        </div>
      </div>
      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 10 }}>{msg.text}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {EXPORT_TARGETS.map((target) => (
          <button
            key={target.key}
            type="button"
            onClick={() => handleExport(target)}
            disabled={exportingKey !== null}
          >
            {exportingKey === target.key ? "กำลังสร้างไฟล์..." : `📤 ดาวน์โหลด CSV (${target.label})`}
          </button>
        ))}
      </div>
    </div>
  );
}

// การ์ด "ย้ายอะไหล่ระหว่าง Zone" — checklist ตอน setup: "บังคับสแกน QR ยืนยันตำแหน่งอะไหล่ไหม?"
// ✅ ตัดสินใจแล้วในการ์ด (19 ก.ค. 2026): default ปิด — เปิดได้ที่นี่ ตั้งค่าระดับร้าน (owner/manager)
// เมื่อเปิด: หน้า /add และ action "ย้าย Zone" (/move-part/[id]) จะบังคับให้สแกน QR โซนเท่านั้น
// เลือกจาก dropdown ตรงๆ ไม่ได้อีกต่อไป
function ZoneMoveSettingsCard() {
  const { currentShopId } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!currentShopId) return;
    supabase
      .from("shops")
      .select("force_zone_scan_confirmation")
      .eq("shop_id", currentShopId)
      .single()
      .then(({ data }) => {
        setEnabled(!!data?.force_zone_scan_confirmation);
        setLoaded(true);
      });
  }, [currentShopId]);

  async function handleToggle() {
    const next = !enabled;
    setSaving(true);
    setMsg(null);
    const { error } = await supabase
      .from("shops")
      .update({ force_zone_scan_confirmation: next })
      .eq("shop_id", currentShopId);
    if (error) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + error.message });
    } else {
      setEnabled(next);
      setMsg({ type: "success", text: "บันทึกแล้ว ✅" });
    }
    setSaving(false);
  }

  if (!loaded) return null;

  return (
    <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
      <div className="card-body" style={{ marginBottom: 10 }}>
        <div className="card-title">📍 บังคับสแกน QR ยืนยันตำแหน่ง</div>
        <div className="card-sub">
          เปิดแล้วตอนย้าย Zone (และเพิ่มอะไหล่ใหม่ที่ /add) จะต้องสแกน QR โซนปลายทางเท่านั้น
          เลือกจากช่องค้นหาตรงๆ ไม่ได้ — กันเลือกโซนมั่วโดยไม่ได้อยู่ที่จุดจริง
        </div>
      </div>
      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 10 }}>{msg.text}</div>}
      <button type="button" data-testid="toggle-force-scan" onClick={handleToggle} disabled={saving}>
        {enabled ? "✅ เปิดอยู่ — กดเพื่อปิด" : "⬜ ปิดอยู่ — กดเพื่อเปิด"}
      </button>
    </div>
  );
}

function AdminHubPageContent() {
  const { theme, setTheme } = useTheme();
  const { currentRole, shopHasAdminMember } = useAuth();
  const canManage = currentRole === "owner" || currentRole === "manager";
  const canExport = ["owner", "manager", "supervisor"].includes(currentRole);
  // การ์ด "Admin Role (7th role)" item (3): Admin เข้าร่วม Owner/Manager สำหรับจัดการลูกค้า
  // (import/แก้ไข) — เฉพาะการ์ดนี้เท่านั้น ไม่ขยาย canManage รวม (zone/car-data/shop-info ยังคง
  // owner/manager เท่านั้นตามเดิม ไม่อยู่ใน scope ของ Admin Role)
  const canManageCustomers = canManage || currentRole === "admin";

  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ ตั้งค่าระบบ</h1>
        <Link href="/" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      <div className="card" style={{ cursor: "default", flexDirection: "column", alignItems: "stretch" }}>
        <div className="card-body" style={{ marginBottom: 10 }}>
          <div className="card-title">🎨 ธีมสี</div>
          <div className="card-sub">เลือกสีหน้าจอที่ใช้ทั้งระบบ (จำไว้ในเครื่องนี้)</div>
        </div>
        <div className="view-toggle" style={{ width: "100%" }}>
          <button
            type="button"
            className={theme === "light" ? "active" : ""}
            onClick={() => setTheme("light")}
            style={{ flex: 1 }}
          >
            ☀️ สีสว่าง
          </button>
          <button
            type="button"
            className={theme === "dark" ? "active" : ""}
            onClick={() => setTheme("dark")}
            style={{ flex: 1 }}
          >
            🌙 สีมืด
          </button>
        </div>
      </div>

      <ChangePinCard />

      {canManage && <ShopInfoCard />}

      {canManage && <ZoneMoveSettingsCard />}

      {canExport && <ExportCsvCard />}

      <Link
        href="/admin/groups"
        className="card"
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div className="card-body">
          <div className="card-title">🧑‍🤝‍🧑 กลุ่มผู้ใช้</div>
          <div className="card-sub">สร้างกลุ่ม กำหนดว่าใครเห็นงานไหนบ้าง</div>
        </div>
      </Link>

      <Link
        href="/admin/team"
        className="card"
        style={{ textDecoration: "none", color: "inherit" }}
      >
        <div className="card-body">
          <div className="card-title">👥 จัดการทีม</div>
          <div className="card-sub">เชิญสมาชิก กำหนด/เปลี่ยนสิทธิ์ ปิดการใช้งาน</div>
        </div>
      </Link>

      {canManage && (
        <Link
          href="/admin/car-data"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🚗 ข้อมูลรถ (ยี่ห้อ/รุ่น/ปี)</div>
            <div className="card-sub">แก้ไข/เพิ่มยี่ห้อ รุ่น และช่วงปีผลิต พร้อมดูประวัติการแก้ไข</div>
          </div>
        </Link>
      )}

      {canManageCustomers && (
        <Link
          href="/admin/import-customers"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">📥 นำเข้าข้อมูลลูกค้าเดิม</div>
            <div className="card-sub">อัปโหลด CSV รายชื่อลูกค้าจากระบบ/ไฟล์เก่า</div>
          </div>
        </Link>
      )}

      {/* การ์ด "Admin Role (7th role)" — simplify principle: 2 การ์ดนี้แสดงเฉพาะร้านที่มี user
          role admin อยู่จริงอย่างน้อย 1 คน (shopHasAdminMember) ร้านที่ไม่เคย invite admin เลย
          ไม่เห็นเมนูนี้เลย ไม่มี overhead ใดๆ เพิ่ม */}
      {canManage && shopHasAdminMember && (
        <Link
          href="/admin/settings/admin-approvals"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">⚙️ ตั้งค่าการขออนุมัติ (Admin)</div>
            <div className="card-sub">กำหนดว่างานไหนที่ Admin ทำแล้วต้องรออนุมัติ</div>
          </div>
        </Link>
      )}

      {canManageCustomers && (
        <Link
          href="/admin/job-type-bundles"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🧰 เซตอะไหล่+ค่าแรงตามประเภทงาน</div>
            <div className="card-sub">ดู/แก้/ลบเซตที่ใช้ตอนเลือกประเภทงานในหน้างาน</div>
          </div>
        </Link>
      )}

      {canManageCustomers && shopHasAdminMember && (
        <Link
          href="/admin/admin-approvals"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🕒 รออนุมัติ</div>
            <div className="card-sub">ตรวจ/อนุมัติงานที่ Admin ส่งมารออนุมัติ</div>
          </div>
        </Link>
      )}

      {canManage && (
        <Link
          href="/admin/zones"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">📍 โซนจัดเก็บ</div>
            <div className="card-sub">เพิ่ม/ลบรหัสโซนที่ใช้ในอู่</div>
          </div>
        </Link>
      )}

      {canManage && (
        <Link
          href="/admin/options"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🏷️ สภาพ / ที่มา / สถานะ</div>
            <div className="card-sub">แก้ไข/เพิ่มตัวเลือกที่ใช้ตอนเพิ่มอะไหล่</div>
          </div>
        </Link>
      )}

      {canManage && (
        <Link
          href="/admin/bulk-update"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🔁 Bulk Update</div>
            <div className="card-sub">เปลี่ยนสภาพ/ที่มา/สถานะ/โซน ของอะไหล่หลายชิ้นพร้อมกันทีเดียว</div>
          </div>
        </Link>
      )}

      {canManage && (
        <Link
          href="/admin/trash"
          className="card"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          <div className="card-body">
            <div className="card-title">🗑️ ถังขยะ</div>
            <div className="card-sub">กู้คืน หรือลบอะไหล่ที่ซ่อนไว้ถาวร</div>
          </div>
        </Link>
      )}
    </div>
  );
}

export default function AdminHubPage() {
  return (
    <RequireAuth requiredFeature="admin_basic">
      <AdminHubPageContent />
    </RequireAuth>
  );
}
