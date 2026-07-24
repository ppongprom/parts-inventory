import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller } from "../../../../lib/teamAuth";
import { getTierConfig } from "../../../../config/subscriptionTiers";
import { REPORTING_THRESHOLDS } from "../../../../config/reportingThresholds";
import { canSeeField } from "../../../../config/fieldVisibility";

// Card: "รายงานสรุปสต็อก (Stock Summary Report) — Pro+" (Notion 3a1f39f4564981d1a15ed167dcd8031b)
//
// Tier + role gate follows the exact pattern already used by app/api/sales/export-csv/route.js
// (the only other API route in this project that gates a feature by subscription tier at the
// API layer): verifyCaller() for auth, look up caller's shop_members.role, look up
// shops.subscription_plan, getTierConfig(), 403 with a Thai message if not eligible. Role gate
// matches app/admin/reports/page.js's RequireAuth allowedRoles=["owner","manager"] exactly (the
// only existing report page in the app).
//
// "Pro+" = pro or enterprise tier (config/subscriptionTiers.js: only these two tiers list
// "reports" — enterprise lists "all" instead of an explicit feature array, per its own convention
// of "all" meaning every feature) — trial/starter/founder are NOT eligible.
//
// Section 1 formula reuse: see db/stock_summary_report_migration.sql's top comment. This route
// does not recompute the parts-value formula in JS — it calls the SQL functions created there
// (fn_shop_stock_summary_totals, fn_shop_vehicle_remaining_value, fn_shop_salvage_vehicle_summary,
// fn_shop_parts_stock_value) via supabaseAdmin.rpc(), which is the same connection/service-role
// path app/api/sales/export-csv/route.js already uses for cross-table aggregation.
//
// Reporting is real-time / live only (matches the Stock Value Cap Engine) — no month-end
// snapshot / point-in-time-in-the-past capability. Known, explicitly deferred gap — see
// db/stock_summary_report_migration.sql's "NOT implemented this run" note.

function hasReportsFeature(tier) {
  return (tier.features || []).includes("reports") || (tier.features || []).includes("all");
}

export async function GET(request) {
  try {
    const authResult = await verifyCaller(request);
    if (authResult.error) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }

    const { searchParams } = new URL(request.url);
    const shopId = Number(searchParams.get("shop_id"));
    if (!shopId) {
      return NextResponse.json({ error: "ไม่พบ shop_id" }, { status: 400 });
    }

    // Top 10 best/slow sellers window — defaults to REPORTING_THRESHOLDS.topSellersDefaultWindowDays
    // (30, provisional — see config/reportingThresholds.js) but always overridable via ?days= so a
    // future "เลือกได้" UI needs no backend change (card's own still-open question).
    const daysParam = Number(searchParams.get("days"));
    const windowDays =
      Number.isFinite(daysParam) && daysParam > 0 ? daysParam : REPORTING_THRESHOLDS.topSellersDefaultWindowDays;

    const { data: callerMember } = await supabaseAdmin
      .from("shop_members")
      .select("role")
      .eq("shop_id", shopId)
      .eq("user_id", authResult.userId)
      .eq("status", "active")
      .maybeSingle();

    if (!callerMember) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงอู่นี้" }, { status: 403 });
    }

    // การ์ด "Field Visibility Whitelist กลาง (role × field group)" — retrofit: role gate ก่อน
    // หน้านี้ hardcode ["owner","manager"] เอง (คอมเมนต์เดิมบอกว่า "matches
    // app/admin/reports/page.js exactly") — ตอนนี้ทั้งคู่อ้าง matrix กลางเดียวกันแทน
    // (field group "sales_reports" — default: owner/manager/supervisor ✅, admin ✅ เหมือน
    // supervisor, technician/assistant/field_scanner ❌) — ห้ามกำหนดแยกรายฟีเจอร์ตามกติกาข้อ 2
    const { data: overrides } = await supabaseAdmin
      .from("shop_field_visibility_overrides")
      .select("role, field_group, allowed")
      .eq("shop_id", shopId);

    if (!canSeeField(callerMember.role, "sales_reports", overrides || [])) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายงานนี้" }, { status: 403 });
    }

    const canSeeCostPrice = canSeeField(callerMember.role, "cost_price", overrides || []);

    const { data: shop } = await supabaseAdmin
      .from("shops")
      .select("subscription_plan, current_stock_value")
      .eq("shop_id", shopId)
      .maybeSingle();

    const tier = getTierConfig(shop?.subscription_plan);
    if (!hasReportsFeature(tier)) {
      return NextResponse.json(
        { error: `รายงานสรุปสต็อกใช้ได้ตั้งแต่แพ็กเกจ Pro ขึ้นไป (ตอนนี้: ${tier.label})` },
        { status: 403 }
      );
    }

    // ------------------------------------------------------------
    // Section 1 + 2: on-balance / off-balance stock value, reusing the Stock Value Cap Engine's
    // exact cost formula (see db/stock_summary_report_migration.sql).
    // ------------------------------------------------------------
    const [
      { data: totalsRows, error: totalsError },
      { data: partsDetail, error: partsDetailError },
      { data: vehicleRemainingDetail, error: vehicleRemainingError },
      { data: vehicleSummary, error: vehicleSummaryError },
    ] = await Promise.all([
      supabaseAdmin.rpc("fn_shop_stock_summary_totals", { p_shop_id: shopId }),
      supabaseAdmin.rpc("fn_shop_stock_parts_detail", { p_shop_id: shopId }),
      supabaseAdmin.rpc("fn_shop_vehicle_remaining_detail", { p_shop_id: shopId }),
      supabaseAdmin.rpc("fn_shop_salvage_vehicle_summary", { p_shop_id: shopId }),
    ]);

    if (totalsError) throw totalsError;
    if (partsDetailError) throw partsDetailError;
    if (vehicleRemainingError) throw vehicleRemainingError;
    if (vehicleSummaryError) throw vehicleSummaryError;

    const totals = totalsRows?.[0] || {
      onbalance_parts_value: 0,
      onbalance_vehicle_remaining: 0,
      onbalance_total: 0,
      offbalance_parts_value: 0,
      offbalance_vehicle_remaining: 0,
      offbalance_total: 0,
      all_owner_types_parts_value: 0,
    };

    // Breakdown by zone/brand/condition — 'own' parts only (section 1), matching how the
    // engine's own base number (fn_shop_parts_stock_value / shops.current_stock_value) is
    // computed, just grouped for display. Off-balance (section 2) parts broken down by
    // owner_type only, per the card's "memo เท่านั้น" scope (not a full breakdown like section 1).
    const ownParts = (partsDetail || []).filter((p) => p.effective_owner_type === "own");
    const offBalanceParts = (partsDetail || []).filter((p) => p.effective_owner_type !== "own");

    function groupSum(rows, key) {
      const out = {};
      for (const r of rows) {
        const k = r[key] || "ไม่ระบุ";
        out[k] = (out[k] || 0) + Number(r.cost_value);
      }
      return Object.entries(out).map(([label, value]) => ({ label, value }));
    }

    const onBalanceBreakdown = {
      byZone: groupSum(ownParts, "zone_name"),
      byBrand: groupSum(ownParts, "car_brand"),
      byCondition: groupSum(ownParts, "condition"),
    };

    const offBalanceByOwnerType = {};
    for (const r of offBalanceParts) {
      const k = r.effective_owner_type;
      offBalanceByOwnerType[k] = (offBalanceByOwnerType[k] || 0) + Number(r.cost_value);
    }
    for (const r of (vehicleRemainingDetail || []).filter((v) => v.effective_owner_type !== "own")) {
      const k = r.effective_owner_type;
      offBalanceByOwnerType[k] = (offBalanceByOwnerType[k] || 0) + Number(r.remaining_value);
    }

    const section1 = {
      partsValue: Number(totals.onbalance_parts_value),
      remainingVehicleValue: Number(totals.onbalance_vehicle_remaining),
      total: Number(totals.onbalance_total),
      breakdown: onBalanceBreakdown,
    };

    const section2 = {
      partsValue: Number(totals.offbalance_parts_value),
      remainingVehicleValue: Number(totals.offbalance_vehicle_remaining),
      total: Number(totals.offbalance_total),
      byOwnerType: Object.entries(offBalanceByOwnerType).map(([ownerType, value]) => ({ ownerType, value })),
      note: "มูลค่านี้เป็น memo เท่านั้น — ไม่รวมในข้อ 1 (มูลค่าสต็อกที่ขึ้นงบบริษัทจริง)",
    };

    // ------------------------------------------------------------
    // Cross-feature invariant support field: the raw all-owner-types parts value, which must
    // equal shops.current_stock_value (the Stock Value Cap Engine's own running counter) at all
    // times — exposed here mainly so tests/ops can verify it directly without a separate RPC call.
    // ------------------------------------------------------------
    const invariantCheck = {
      allOwnerTypesPartsValue: Number(totals.all_owner_types_parts_value),
      stockValueCapCurrentStockValue: Number(shop?.current_stock_value ?? 0),
    };

    // ------------------------------------------------------------
    // Section 3: per-vehicle status table
    // ------------------------------------------------------------
    const section3 = (vehicleSummary || []).map((v) => ({
      vehicleId: v.vehicle_id,
      status: v.status,
      purchasePrice: Number(v.purchase_price ?? 0),
      cumulativeRevenue: Number(v.cumulative_revenue ?? 0),
      costRecognized: Number(v.cost_recognized ?? 0),
      profit: Number(v.profit ?? 0),
    }));

    // ------------------------------------------------------------
    // Section 4: slow-moving stock (both direct-purchase and salvage-origin parts) — provisional
    // 90-day threshold (REPORTING_THRESHOLDS.staleStockDays, see config/reportingThresholds.js).
    // A part is "stale" if created_at is older than the threshold AND it has never sold (no
    // qualifying part_sales row at all, ever — matches "ค้างสต็อกนาน" meaning literally never
    // moved, not just "hasn't sold in N days").
    // ------------------------------------------------------------
    const { data: allActiveParts, error: allActivePartsError } = await supabaseAdmin
      .from("parts")
      .select("id, part_name, car_brand, condition, created_at, salvage_vehicle_id, price, allocated_cost, quantity")
      .eq("shop_id", shopId)
      .eq("is_active", true);
    if (allActivePartsError) throw allActivePartsError;

    const { data: soldPartIdsRows, error: soldPartIdsError } = await supabaseAdmin
      .from("part_sales")
      .select("part_id")
      .eq("shop_id", shopId)
      .neq("item_status", "not_found")
      .neq("approval_status", "pending_approval");
    if (soldPartIdsError) throw soldPartIdsError;
    const everSoldPartIds = new Set((soldPartIdsRows || []).map((r) => r.part_id));

    const staleThresholdMs = REPORTING_THRESHOLDS.staleStockDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const staleItems = (allActiveParts || [])
      .filter((p) => !everSoldPartIds.has(p.id))
      .filter((p) => p.created_at && now - new Date(p.created_at).getTime() > staleThresholdMs)
      .map((p) => ({
        partId: p.id,
        partName: p.part_name,
        carBrand: p.car_brand,
        condition: p.condition,
        createdAt: p.created_at,
        origin: p.salvage_vehicle_id ? "salvage" : "direct",
        // Field Visibility Whitelist: allocated_cost/ราคาทุน คนละ field group กับ sales_reports
        // เอง (cost_price) — role ที่ผ่าน gate ข้างบนแล้ว (เห็นรายงานได้) อาจถูก shop override
        // ปิด cost_price แยกไว้ก็ได้ ถ้าเป็นแบบนั้น mask ค่านี้เป็น null แทนตัวเลขจริง
        costValue: canSeeCostPrice ? Number(p.allocated_cost ?? p.price ?? 0) * Number(p.quantity ?? 0) : null,
      }));

    const section4 = {
      thresholdDays: REPORTING_THRESHOLDS.staleStockDays,
      thresholdNote:
        "ค่าเริ่มต้นชั่วคราว 90 วัน — ยังไม่มีเลขที่ตัดสินใจจริงจากคุณอั้ม ปรับได้ทีหลังถ้าต้องการ",
      items: staleItems,
    };

    // ------------------------------------------------------------
    // Section 5: Top 10 best/slow sellers, rolling window (default 30 days, ?days= override)
    // ------------------------------------------------------------
    const windowStart = new Date(now - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data: windowSales, error: windowSalesError } = await supabaseAdmin
      .from("part_sales")
      .select("part_id, quantity_sold, sale_price")
      .eq("shop_id", shopId)
      .neq("item_status", "not_found")
      .neq("approval_status", "pending_approval")
      .gte("sold_at", windowStart);
    if (windowSalesError) throw windowSalesError;

    const salesByPart = {};
    for (const s of windowSales || []) {
      if (!s.part_id) continue;
      const qty = Number(s.quantity_sold || 0);
      const revenue = qty * Number(s.sale_price || 0);
      if (!salesByPart[s.part_id]) salesByPart[s.part_id] = { qty: 0, revenue: 0 };
      salesByPart[s.part_id].qty += qty;
      salesByPart[s.part_id].revenue += revenue;
    }

    const partIds = Object.keys(salesByPart);
    let partNameById = {};
    if (partIds.length) {
      const { data: partsForNames } = await supabaseAdmin.from("parts").select("id, part_name").in("id", partIds);
      partNameById = Object.fromEntries((partsForNames || []).map((p) => [p.id, p.part_name]));
    }

    const rankedByQty = Object.entries(salesByPart)
      .map(([partId, v]) => ({ partId, partName: partNameById[partId] || null, qtySold: v.qty, revenue: v.revenue }))
      .sort((a, b) => b.qtySold - a.qtySold);

    // "ข้อมูลน้อยกว่า 10 -> แสดงเท่าที่มี ไม่ crash" — .slice() naturally handles this (never
    // throws if array shorter than requested count)
    const section5 = {
      windowDays,
      topSellers: rankedByQty.slice(0, 10),
      slowSellers: [...rankedByQty].sort((a, b) => a.qtySold - b.qtySold).slice(0, 10),
    };

    return NextResponse.json({
      section1,
      section2,
      section3,
      section4,
      section5,
      invariantCheck,
      generatedAt: new Date().toISOString(),
      liveOnlyNote:
        "รายงานนี้แสดงข้อมูล ณ เวลาปัจจุบันเท่านั้น (real-time เหมือน Stock Value Cap Engine) — ยังไม่รองรับดูย้อนหลัง ณ สิ้นเดือนที่ผ่านมา (snapshot) — เป็น known gap ที่ตั้งใจเลื่อนไว้",
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
