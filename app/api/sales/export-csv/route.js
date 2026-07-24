import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller, getCallerShopRole } from "../../../../lib/teamAuth";
import { toCsv } from "../../../../lib/csvExport";
import { getTierConfig } from "../../../../config/subscriptionTiers";
import { canSeeField } from "../../../../config/fieldVisibility";

// Export CSV (Starter+) — การ์ด "Export CSV (Starter+)" ส่วน "Sales" (ใหม่ — เพิ่มเข้ามาในการ์ด
// 19 ก.ค. 2026 หลังมี Cart-based selling flow + payment_method แล้ว ยังไม่เคยทำมาก่อน)
//
// การ์ด Field Visibility Whitelist ไม่มี field group แยกสำหรับ "export_csv_sales" โดยเฉพาะ
// (มีแค่ export_csv_parts/export_csv_jobs) — ใช้ "export_csv_parts" เป็น row-level gate แทน
// (เหตุผล: ข้อมูลการขายผูกกับอะไหล่โดยตรง อยู่ในหมวดเดียวกับ parts มากกว่า jobs) — เป็นการตีความ
// ของเราเอง ไม่ใช่มติที่การ์ดระบุตรงๆ ปรับได้ทีหลังถ้าคุณอั้มต้องการ field group แยกจริงๆ
//
// buyer_name/buyer_phone: การขายผ่านตะกร้า (Cart-based selling flow) เก็บที่ sale_orders
// (buyer_name/buyer_phone) ส่วนการขายทีละชิ้นแบบเดิมที่ /edit/[id] (ก่อนมีตะกร้า) เก็บแค่ชื่อผู้ซื้อ
// ที่ part_sales.sold_to (ไม่มีเบอร์โทรแยก) — รวม 2 แหล่งนี้เข้าด้วยกัน (coalesce), กรองด้วย
// field group เดียวกับ "ชื่อลูกค้า"/"เบอร์โทรลูกค้า" เพราะเป็นข้อมูลบุคคลอ่อนไหวแบบเดียวกัน

const COLUMNS = [
  { key: "sale_id", header: "sale_id" },
  { key: "part_name", header: "part_name" },
  { key: "quantity_sold", header: "quantity_sold" },
  { key: "sale_price", header: "sale_price" },
  { key: "payment_method", header: "payment_method" },
  { key: "sold_by", header: "sold_by" },
  { key: "sold_at", header: "sold_at" },
  { key: "buyer_name", header: "buyer_name" },
  { key: "buyer_phone", header: "buyer_phone" },
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

    const canSeeCustomerName = canSeeField(callerMember.role, "customer_name", overrides || []);
    const canSeeCustomerPhone = canSeeField(callerMember.role, "customer_phone", overrides || []);

    const { data: sales, error: salesError } = await supabaseAdmin
      .from("part_sales")
      .select("sale_id, part_id, quantity_sold, sale_price, payment_method, sold_by, sold_at, sold_to, order_id")
      .eq("shop_id", shopId)
      .order("sold_at", { ascending: false });
    if (salesError) throw salesError;

    const partIds = [...new Set((sales || []).map((s) => s.part_id).filter(Boolean))];
    const soldByIds = [...new Set((sales || []).map((s) => s.sold_by).filter(Boolean))];
    const orderIds = [...new Set((sales || []).map((s) => s.order_id).filter(Boolean))];

    const [{ data: parts }, { data: sellers }, { data: orders }] = await Promise.all([
      partIds.length
        ? supabaseAdmin.from("parts").select("id, part_name").in("id", partIds)
        : Promise.resolve({ data: [] }),
      soldByIds.length
        ? supabaseAdmin
            .from("shop_members")
            .select("user_id, contact_name, login_username")
            .eq("shop_id", shopId)
            .in("user_id", soldByIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? supabaseAdmin.from("sale_orders").select("order_id, buyer_name, buyer_phone").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
    ]);

    const partNameById = Object.fromEntries((parts || []).map((p) => [p.id, p.part_name]));
    const sellerById = Object.fromEntries(
      (sellers || []).map((m) => [m.user_id, m.contact_name || m.login_username || m.user_id])
    );
    const orderById = Object.fromEntries((orders || []).map((o) => [o.order_id, o]));

    const rows = (sales || []).map((s) => {
      const order = s.order_id ? orderById[s.order_id] : null;
      const buyerName = order?.buyer_name ?? s.sold_to ?? null;
      const buyerPhone = order?.buyer_phone ?? null;
      return {
        sale_id: s.sale_id,
        part_name: s.part_id ? partNameById[s.part_id] : null,
        quantity_sold: s.quantity_sold,
        sale_price: s.sale_price,
        payment_method: s.payment_method,
        sold_by: s.sold_by ? sellerById[s.sold_by] || s.sold_by : null,
        sold_at: s.sold_at,
        buyer_name: canSeeCustomerName ? buyerName : null,
        buyer_phone: canSeeCustomerPhone ? buyerPhone : null,
      };
    });

    const csv = toCsv(rows, COLUMNS);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sales-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
