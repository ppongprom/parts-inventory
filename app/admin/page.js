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
          Username: {currentShop.login_username} — ตั้ง PIN/รหัสผ่านใหม่ได้เอง (ตัวอักษร+ตัวเลขผสมได้ ยาว 4-20 ตัว)
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

function AdminHubPageContent() {
  const { theme, setTheme } = useTheme();

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

      <ShopInfoCard />

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
    </div>
  );
}

export default function AdminHubPage() {
  return (
    <RequireAuth>
      <AdminHubPageContent />
    </RequireAuth>
  );
}
