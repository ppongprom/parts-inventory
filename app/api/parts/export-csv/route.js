import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller, getCallerShopRole } from "../../../../lib/teamAuth";
import { toCsv } from "../../../../lib/csvExport";
import { formatBreadcrumb } from "../../../../lib/zoneHelpers";
import { getTierConfig } from "../../../../config/subscriptionTiers";
import { canSeeField } from "../../../../config/fieldVisibility";

// Export CSV (Starter+) — การ์ด "Export CSV (Starter+)"
//
// ขอบเขตของ route นี้ (ทำเฉพาะ Parts ก่อน — Jobs/Sales CSV เก็บไว้ทำรอบหน้า):
// - "Jobs" CSV และ "Sales" CSV ในการ์ดต้องพึ่งฟีเจอร์ที่ยังไม่มีจริงในระบบตอนนี้ (payment_method,
//   cart-based selling flow ที่การ์ด Sales section อ้างถึงโดยตรง) — เดาทำเองคืนนี้เสี่ยงเกินไป
//   ทำ Parts CSV ให้ครบตาม spec ที่ทำได้จริงกับ schema ปัจจุบันก่อน
//
// ✅ ตัดสินใจแล้วในการ์ด ที่ทำตามในไฟล์นี้:
// - Format: UTF-8 with BOM (lib/csvExport.js)
// - Tier gate: Trial ไม่ได้ (Starter ขึ้นไป) — เช็ค 403 ที่นี่ (ชั้นที่ 2 คู่กับ UI ที่ซ่อนปุ่ม)
// - สิทธิ์: อ้างอิง Field Visibility Whitelist กลาง (config/fieldVisibility.js field group
//   "export_csv_parts") แทนรายชื่อ role ที่เคย hardcode ไว้ตรงนี้เอง — ตรงกับกติกาข้อ 2 ของการ์ด
//   Field Visibility ที่บอกว่า "ทุกช่องทางต้องอ้าง matrix เดียวกัน ห้ามกำหนดแยกรายฟีเจอร์"
//   default ปัจจุบันของ matrix (owner/manager/supervisor=true, technician/assistant/
//   field_scanner=false) ให้ผลเหมือนเดิมทุกประการ — ต่างกันตรงที่ตอนนี้ Owner override ต่อร้านได้
//   ผ่าน shop_field_visibility_overrides (ยังไม่มี UI ให้ตั้งค่าคืนนี้ แต่ backend พร้อมอ่านแล้ว)

const COLUMNS = [
  { key: "part_id", header: "part_id" },
  { key: "part_name", header: "part_name" },
  { key: "part_number", header: "part_number" },
  { key: "car_brand", header: "car_brand" },
  { key: "car_model", header: "car_model" },
  { key: "generation_code", header: "generation_code" },
  { key: "trim_name", header: "trim_name" },
  { key: "condition", header: "condition" },
  { key: "source_type", header: "source_type" },
  { key: "status", header: "status" },
  { key: "zone_path", header: "zone" },
  { key: "owner_type", header: "owner_type" },
  { key: "quantity", header: "quantity" },
  { key: "price", header: "price" },
  { key: "allocated_cost", header: "allocated_cost" },
  { key: "created_at", header: "created_at" },
];

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

    // การ์ด "Multi-branch support" — .maybeSingle() เดิม throw ถ้า user นี้มีหลายแถวใน
    // shop_members ของ shop เดียวกัน (role ต่างกันคนละสาขา) เปลี่ยนมาใช้ getCallerShopRole()
    // ที่รวม role สูงสุดข้ามทุกสาขาแทน (ร้านสาขาเดียวพฤติกรรมเหมือนเดิมทุกประการ)
    const callerRole = await getCallerShopRole(shopId, authResult.userId);
    if (!callerRole) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึงอู่นี้" }, { status: 403 });
    }
    const callerMember = { role: callerRole };

    const { data: overrides } = await supabaseAdmin
      .from("shop_field_visibility_overrides")
      .select("role, field_group, allowed")
      .eq("shop_id", shopId);

    if (!canSeeField(callerMember.role, "export_csv_parts", overrides || [])) {
      return NextResponse.json(
        { error: "เฉพาะเจ้าของ/ผู้จัดการ/หัวหน้างานเท่านั้นที่ export ได้" },
        { status: 403 }
      );
    }

    const { data: shop } = await supabaseAdmin
      .from("shops")
      .select("subscription_plan")
      .eq("shop_id", shopId)
      .maybeSingle();

    const tier = getTierConfig(shop?.subscription_plan);
    if (shop?.subscription_plan === "trial") {
      return NextResponse.json(
        { error: `Export CSV ใช้ได้ตั้งแต่แพ็กเกจ Starter ขึ้นไป (ตอนนี้: ${tier.label})` },
        { status: 403 }
      );
    }

    const { data: parts, error: partsError } = await supabaseAdmin
      .from("parts")
      .select(
        "id, part_name, part_number, car_brand, car_model, generation_id, trim_id, condition, source_type, status, zone_id, quantity, price, allocated_cost, created_at"
      )
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false });
    if (partsError) throw partsError;

    // การ์ด "Salvage vehicle cost allocation" เพิ่ม allocated_cost เข้ามาใหม่ (คนละคอลัมน์กับ
    // price/ราคาขาย) — floor เดียวกับ "ราคาทุน" (cost_price field group) ตามที่การ์ด Export CSV
    // ระบุไว้ว่า allocated_cost เป็น field ที่ต้องกรองตาม Field Visibility Whitelist — ต่างจาก
    // price/ราคาขายที่ role ทุกตัวที่ export ได้ (Supervisor+) เห็นได้อยู่แล้วโดย default
    const canSeeCostPrice = canSeeField(callerMember.role, "cost_price", overrides || []);

    const [{ data: zones }, { data: generations }, { data: trims }] = await Promise.all([
      supabaseAdmin.from("zones").select("id, parent_id, code, owner_type").eq("shop_id", shopId),
      supabaseAdmin.from("model_generations").select("generation_id, generation_code"),
      supabaseAdmin.from("model_trims").select("trim_id, trim_name"),
    ]);

    const zoneList = zones || [];
    const zoneById = Object.fromEntries(zoneList.map((z) => [z.id, z]));
    const generationCodeById = Object.fromEntries((generations || []).map((g) => [g.generation_id, g.generation_code]));
    const trimNameById = Object.fromEntries((trims || []).map((t) => [t.trim_id, t.trim_name]));

    const rows = (parts || []).map((p) => {
      const zone = p.zone_id ? zoneById[p.zone_id] : null;
      return {
        part_id: p.id,
        part_name: p.part_name,
        part_number: p.part_number,
        car_brand: p.car_brand,
        car_model: p.car_model,
        generation_code: p.generation_id ? generationCodeById[p.generation_id] : null,
        trim_name: p.trim_id ? trimNameById[p.trim_id] : null,
        condition: p.condition,
        source_type: p.source_type,
        status: p.status,
        zone_path: p.zone_id ? formatBreadcrumb(zoneList, p.zone_id) : null,
        owner_type: zone?.owner_type ?? null,
        quantity: p.quantity,
        price: p.price,
        allocated_cost: canSeeCostPrice ? p.allocated_cost : null,
        created_at: p.created_at,
      };
    });

    const csv = toCsv(rows, COLUMNS);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="parts-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
