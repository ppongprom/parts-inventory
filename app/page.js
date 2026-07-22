"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "../lib/supabaseClient";
import { getViewMode, setViewMode } from "../lib/viewModeStorage";
import { useAuth } from "../lib/AuthProvider";
import RequireAuth from "../components/RequireAuth";
import { ROLE_PERMISSIONS } from "../config/rolePermissions";
import { getDescendantIds, formatBreadcrumb, getSortedZoneList } from "../lib/zoneHelpers";

const PAGE_SIZE = 50;

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentShopId, currentShop, currentRole, signOut } = useAuth();

  // ⚠️ router.replace("/login") เอง อย่าพึ่งแค่ RequireAuth คอยจับ session ว่างแล้วค่อย redirect
  // (ดู TC-303 — ไม่งั้นผู้ใช้ค้างอยู่หน้าเดิมชั่วขณะหลังกด "ออกจากระบบ")
  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  const [parts, setParts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const [viewMode, setViewModeState] = useState("list");
  // null = ปิดโหมดเลือกทั้งคู่, "qr" = เลือกพิมพ์ QR (เดิม), "sell" = เลือกขาย (ตะกร้า, ใหม่)
  // เคลียร์ selection ทันทีที่สลับโหมด (ตัดสินใจแล้วในการ์ด Cart-based selling flow — กันสับสนเจตนา)
  const [selectMode, setSelectMode] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const canSell = ROLE_PERMISSIONS[currentRole]?.sell_parts ?? false;

  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState("");
  const [zoneFilter, setZoneFilter] = useState(searchParams.get("zone") || "");
  const [zones, setZones] = useState([]);
  const [brands, setBrands] = useState([]);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [lowStockOnly, setLowStockOnly] = useState(false);

  const debounceRef = useRef(null);

  useEffect(() => {
    setViewModeState(getViewMode());
  }, []);

  useEffect(() => {
    if (!currentShopId) return;
    fetchZones();
    fetchBrands();
    fetchParts(0, false);
    fetchLowStockCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function fetchLowStockCount() {
    const { count } = await supabase
      .from("low_stock_parts")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", currentShopId);
    setLowStockCount(count || 0);
  }

  useEffect(() => {
    if (!currentShopId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchParts(0, false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, brandFilter, zoneFilter, lowStockOnly, zones]);

  function handleViewModeChange(mode) {
    setViewModeState(mode);
    setViewMode(mode);
  }

  async function fetchZones() {
    const { data, error } = await supabase
      .from("zones")
      .select("*")
      .eq("shop_id", currentShopId)
      .order("code", { ascending: true });
    if (!error) setZones(data || []);
  }

  async function fetchBrands() {
    const { data, error } = await supabase
      .from("parts")
      .select("car_brand")
      .eq("shop_id", currentShopId)
      .eq("is_active", true)
      .not("car_brand", "is", null);
    if (!error && data) {
      const unique = [...new Set(data.map((d) => d.car_brand).filter(Boolean))].sort();
      setBrands(unique);
    }
  }

  async function fetchParts(pageNum, append) {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setErrorMsg("");

    let query = supabase
      .from(lowStockOnly ? "low_stock_parts" : "parts")
      .select("*")
      .eq("shop_id", currentShopId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (search.trim()) {
      const s = search.trim();
      query = query.or(`part_name.ilike.%${s}%,car_model.ilike.%${s}%`);
    }
    if (brandFilter) query = query.eq("car_brand", brandFilter);
    if (zoneFilter) query = query.in("zone_id", getDescendantIds(zones, zoneFilter));

    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    query = query.range(from, to);

    const { data, error } = await query;

    if (error) {
      setErrorMsg("โหลดข้อมูลไม่สำเร็จ: " + error.message);
    } else {
      const newData = data || [];
      setParts((prev) => (append ? [...prev, ...newData] : newData));
      setHasMore(newData.length === PAGE_SIZE);
      setPage(pageNum);
    }

    setLoading(false);
    setLoadingMore(false);
  }

  function handleLoadMore() {
    fetchParts(page + 1, true);
  }

  const subStatus = currentShop?.subscription_status;
  const canViewPrice = ROLE_PERMISSIONS[currentRole]?.view_price ?? true;

  return (
    <div className="container">
      <div className="header">
        <h1>📦 {currentShop?.shop_name || "สต็อกอะไหล่"}</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/jobs" className="nav-link secondary">
            🔧 งานเข้าอู่
          </Link>
          <Link href="/admin" className="nav-link secondary">
            ⚙️ ตั้งค่า
          </Link>
          <Link href="/add" className="nav-link">
            + เพิ่มอะไหล่
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, fontSize: 12, color: "var(--text-muted)" }}>
        <span>บทบาทของคุณ: {currentRole}</span>
        <button
          type="button"
          onClick={handleSignOut}
          style={{ background: "none", border: "none", color: "var(--link)", cursor: "pointer", fontSize: 12 }}
        >
          ออกจากระบบ
        </button>
      </div>

      {subStatus === "past_due" && (
        <div className="msg error" style={{ marginBottom: 16 }}>
          ⚠️ อู่นี้ค้างชำระค่าสมาชิก กรุณาชำระเงินก่อนถูกระงับการใช้งาน
        </div>
      )}
      {subStatus === "suspended" && (
        <div className="msg error" style={{ marginBottom: 16 }}>
          🚫 อู่นี้ถูกระงับการใช้งาน (ดูได้อย่างเดียว) — ชำระเงินเพื่อกลับมาใช้งานเต็มรูปแบบ
        </div>
      )}

      {lowStockCount > 0 && (
        <button
          type="button"
          onClick={() => setLowStockOnly((v) => !v)}
          className="no-print"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: 12,
            borderRadius: 8,
            border: "1px solid #f59e0b",
            background: lowStockOnly ? "#f59e0b" : "rgba(245, 158, 11, 0.1)",
            color: lowStockOnly ? "white" : "#f59e0b",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          ⚠️ มีของสิ้นเปลืองใกล้หมด {lowStockCount} รายการ — {lowStockOnly ? "กดเพื่อดูทั้งหมด" : "กดเพื่อดูเฉพาะรายการนี้"}
        </button>
      )}

      <div className="filters" style={{ alignItems: "center" }}>
        <input
          type="text"
          placeholder="ค้นหาชื่ออะไหล่ / รุ่นรถ"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
          <option value="">ทุกยี่ห้อ</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <select value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
          <option value="">ทุกโซน</option>
          {getSortedZoneList(zones).map((z) => (
            <option key={z.id} value={z.id}>
              {formatBreadcrumb(zones, z.id)}
              {z.name ? ` — ${z.name}` : ""}
            </option>
          ))}
        </select>
        <div className="view-toggle">
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => handleViewModeChange("list")}
          >
            📃 List
          </button>
          <button
            type="button"
            className={viewMode === "gallery" ? "active" : ""}
            onClick={() => handleViewModeChange("gallery")}
          >
            🖼 Gallery
          </button>
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectMode((m) => (m === "qr" ? null : "qr"));
            setSelectedIds([]);
          }}
          className="no-print"
          style={{
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: selectMode === "qr" ? "#2563eb" : "var(--surface)",
            color: selectMode === "qr" ? "white" : "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
            marginLeft: 8,
          }}
        >
          🏷️ {selectMode === "qr" ? "ยกเลิกเลือก" : "เลือกพิมพ์ QR"}
        </button>
        {canSell && (
          <button
            type="button"
            onClick={() => {
              setSelectMode((m) => (m === "sell" ? null : "sell"));
              setSelectedIds([]);
            }}
            className="no-print"
            style={{
              padding: "8px 14px",
              borderRadius: 8,
              border: "1px solid var(--border-strong)",
              background: selectMode === "sell" ? "#16a34a" : "var(--surface)",
              color: selectMode === "sell" ? "white" : "var(--text-muted)",
              fontSize: 13,
              cursor: "pointer",
              marginLeft: 8,
            }}
          >
            🛒 {selectMode === "sell" ? "ยกเลิกเลือก" : "เลือกขาย"}
          </button>
        )}
      </div>

      {errorMsg && <div className="msg error">{errorMsg}</div>}
      {loading && <div className="empty">กำลังโหลด...</div>}

      {!loading && parts.length === 0 && (
        <div className="empty">ยังไม่มีอะไหล่ในระบบ หรือไม่พบผลลัพธ์ที่ค้นหา</div>
      )}

      {viewMode === "list" &&
        parts.map((p) => {
          const isSelected = selectedIds.includes(p.id);
          const CardWrapper = selectMode ? "div" : Link;
          const wrapperProps = selectMode
            ? {
                onClick: () =>
                  setSelectedIds((prev) =>
                    prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                  ),
              }
            : { href: `/edit/${p.id}` };

          return (
            <CardWrapper
              {...wrapperProps}
              className="card"
              key={p.id}
              style={{
                textDecoration: "none",
                color: "inherit",
                position: "relative",
                border: isSelected ? "2px solid #2563eb" : undefined,
              }}
            >
              {selectMode && (
                <div
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isSelected ? "#2563eb" : "var(--surface-alt)",
                    border: "1px solid var(--border-strong)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "white",
                    fontSize: 13,
                  }}
                >
                  {isSelected ? "✓" : ""}
                </div>
              )}
              {p.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.photo_url} alt={p.part_name} loading="lazy" decoding="async" />
              ) : (
                <div className="no-photo">ไม่มีรูป</div>
              )}
              <div className="card-body">
                <div className="card-title">{p.part_name}</div>
                <div className="card-sub">
                  {p.car_brand} {p.car_model} {p.car_year_display ? `(${p.car_year_display})` : ""}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {p.item_type === "consumable" && <span className="tag">🧴 สิ้นเปลือง</span>}
                  {p.zone_id && <span className="tag zone">📍 {formatBreadcrumb(zones, p.zone_id)}</span>}
                  {!p.zone_id && p.zone_code && <span className="tag zone">📍 {p.zone_code}</span>}
                  {p.condition && <span className="tag">{p.condition}</span>}
                  {p.source_type && <span className="tag">{p.source_type}</span>}
                  {p.status && <span className="tag">{p.status}</span>}
                  {p.photo_urls?.length > 1 && (
                    <span className="tag">📷 {p.photo_urls.length} รูป</span>
                  )}
                </div>
                {p.price && canViewPrice && (
                  <div className="card-sub" style={{ marginTop: 2 }}>
                    ราคา: {Number(p.price).toLocaleString()} บาท
                  </div>
                )}
              </div>
            </CardWrapper>
          );
        })}

      {selectMode === "qr" && selectedIds.length > 0 && (
        <div
          className="no-print"
          style={{
            position: "sticky",
            bottom: 16,
            display: "flex",
            justifyContent: "center",
            marginTop: 16,
          }}
        >
          <Link
            href={`/print-labels?ids=${selectedIds.join(",")}`}
            className="nav-link"
            style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.3)" }}
          >
            🏷️ พิมพ์ QR ที่เลือก ({selectedIds.length})
          </Link>
        </div>
      )}

      {selectMode === "sell" && selectedIds.length > 0 && (
        <div
          className="no-print"
          style={{
            position: "sticky",
            bottom: 16,
            display: "flex",
            justifyContent: "center",
            marginTop: 16,
          }}
        >
          <Link
            href={`/checkout?ids=${selectedIds.join(",")}`}
            className="nav-link"
            style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.3)", background: "#16a34a" }}
          >
            🛒 ไปหน้าขาย ({selectedIds.length} ชิ้น)
          </Link>
        </div>
      )}

      {viewMode === "gallery" && (
        <div className="gallery-grid">
          {parts.map((p) => {
            const isSelected = selectedIds.includes(p.id);
            const GalleryWrapper = selectMode ? "div" : Link;
            const galleryWrapperProps = selectMode
              ? {
                  onClick: () =>
                    setSelectedIds((prev) =>
                      prev.includes(p.id) ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                    ),
                }
              : { href: `/edit/${p.id}` };

            return (
              <GalleryWrapper
                {...galleryWrapperProps}
                className="gallery-item"
                key={p.id}
                style={{
                  cursor: "pointer",
                  border: isSelected ? "2px solid #2563eb" : undefined,
                }}
              >
                {selectMode && (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      zIndex: 1,
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: isSelected ? "#2563eb" : "var(--surface-alt)",
                      border: "1px solid var(--border-strong)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "white",
                      fontSize: 13,
                    }}
                  >
                    {isSelected ? "✓" : ""}
                  </div>
                )}
                {p.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo_url} alt={p.part_name} loading="lazy" decoding="async" />
                ) : (
                  <div className="no-photo">ไม่มีรูป</div>
                )}
                <div className="gallery-caption">
                  {p.part_name}
                  {p.photo_urls?.length > 1 ? ` · 📷${p.photo_urls.length}` : ""}
                </div>
              </GalleryWrapper>
            );
          })}
        </div>
      )}

      {!loading && hasMore && parts.length > 0 && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          style={{
            width: "100%",
            padding: 14,
            marginTop: 8,
            borderRadius: 8,
            border: "1px solid var(--border-strong)",
            background: "var(--surface)",
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {loadingMore ? "กำลังโหลด..." : "โหลดเพิ่มเติม"}
        </button>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <RequireAuth>
      <Suspense fallback={<div className="container">กำลังโหลด...</div>}>
        <HomePageContent />
      </Suspense>
    </RequireAuth>
  );
}
