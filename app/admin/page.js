"use client";

import Link from "next/link";

export default function AdminHubPage() {
  return (
    <div className="container">
      <div className="header">
        <h1>⚙️ ตั้งค่าระบบ</h1>
        <Link href="/" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

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
    </div>
  );
}
