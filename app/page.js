"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../lib/supabaseClient";

export default function HomePage() {
  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState("");
  const [zones, setZones] = useState([]);

  useEffect(() => {
    fetchParts();
    fetchZones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchZones() {
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .order("code", { ascending: true });
    if (!error) setZones(data || []);
  }

  async function fetchParts() {
    setLoading(true);
    setErrorMsg("");
    const { data, error } = await supabase
      .from("parts")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setErrorMsg("โหลดข้อมูลไม่สำเร็จ: " + error.message);
    } else {
      setParts(data || []);
    }
    setLoading(false);
  }

  const filtered = parts.filter((p) => {
    const matchSearch =
      !search ||
      p.part_name?.toLowerCase().includes(search.toLowerCase()) ||
      p.car_model?.toLowerCase().includes(search.toLowerCase());
    const matchBrand =
      !brandFilter ||
      p.car_brand?.toLowerCase() === brandFilter.toLowerCase();
    const matchZone = !zoneFilter || p.zone_code === zoneFilter;
    return matchSearch && matchBrand && matchZone;
  });

  const uniqueBrands = [...new Set(parts.map((p) => p.car_brand).filter(Boolean))];

  return (
    <div className="container">
      <div className="header">
        <h1>📦 สต็อกอะไหล่</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/admin" className="nav-link secondary">
            ⚙️ ตั้งค่า
          </Link>
          <Link href="/add" className="nav-link">
            + เพิ่มอะไหล่
          </Link>
        </div>
      </div>

      <div className="filters">
        <input
          type="text"
          placeholder="ค้นหาชื่ออะไหล่ / รุ่นรถ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option value="">ทุกยี่ห้อ</option>
          {uniqueBrands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
          <option value="">ทุกโซน</option>
          {zones.map((z) => (
            <option key={z.id} value={z.code}>
              {z.code}
              {z.name ? ` — ${z.name}` : ""}
            </option>
          ))}
        </select>
      </div>

      {errorMsg && <div className="msg error">{errorMsg}</div>}
      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && filtered.length === 0 && (
        <div className="empty">ยังไม่มีอะไหล่ในระบบ หรือไม่พบผลลัพธ์ที่ค้นหา</div>
      )}

      {filtered.map((p) => (
        <Link
          href={`/edit/${p.id}`}
          className="card"
          key={p.id}
          style={{ textDecoration: "none", color: "inherit" }}
        >
          {p.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.photo_url} alt={p.part_name} />
          ) : (
            <div className="no-photo">ไม่มีรูป</div>
          )}
          <div className="card-body">
            <div className="card-title">{p.part_name}</div>
            <div className="card-sub">
              {p.car_brand} {p.car_model} {p.car_year ? `(${p.car_year})` : ""}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.zone_code && <span className="tag zone">📍 {p.zone_code}</span>}
              {p.condition && <span className="tag">{p.condition}</span>}
              {p.source_type && <span className="tag">{p.source_type}</span>}
              {p.status && <span className="tag">{p.status}</span>}
            </div>
            {p.price && (
              <div className="card-sub" style={{ marginTop: 2 }}>
                ราคา: {Number(p.price).toLocaleString()} บาท
              </div>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
