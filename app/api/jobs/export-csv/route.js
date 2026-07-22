import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller } from "../../../../lib/teamAuth";
import { toCsv } from "../../../../lib/csvExport";
import { getTierConfig } from "../../../../config/subscriptionTiers";
import { canSeeField } from "../../../../config/fieldVisibility";

// Export CSV (Starter+) — การ์ด "Export CSV (Starter+)" ส่วน "Jobs" (ยังไม่เคยทำมาก่อน —
// route เดิม app/api/parts/export-csv/route.js ทำแค่ Parts เพราะตอนนั้น payment_method/cart flow
// ยังไม่มี — ตอนนี้มีครบแล้ว จึงเติมส่วน Jobs ตามที่การ์ดออกแบบไว้ 19 ก.ค. 2026)
//
// หมายเหตุการตีความ 2 จุดที่ schema จริงไม่มีชื่อคอลัมน์ตรงตามที่การ์ดเขียนไว้ (การ์ดร่างไว้ก่อน
// implement จริง ไม่ใช่ทุกชื่อ field จะตรงกับคอลัมน์จริงเป๊ะ):
// - "delivered_at" ไม่มีคอลัมน์นี้ตรงๆ ใน jobs — ใช้ jobs.closed_at แทน (ความหมายใกล้เคียงที่สุดที่
//   มีอยู่จริง: เวลาที่ปิดงาน) — ถ้าความหมายจริงต่างจากนี้ ต้องแก้ทีหลังตามที่คุณอั้ม confirm
// - "assignment_status" ไม่มีคอลัมน์นี้ตรงๆ — derive จาก assigned_to IS NULL ง่ายๆ เป็น
//   "unassigned"/"assigned" (ไม่ได้ผูกกับ job_workflow_steps state machine ที่ละเอียดกว่านี้ เพราะ
//   การ์ดไม่ได้ระบุชัดว่าต้องการระดับไหน)
//
// เหมือน Parts export ทุกประการในเรื่อง: format (UTF-8 BOM), tier gate (Starter+), สิทธิ์อ้าง
// Field Visibility Whitelist กลาง (field group "export_csv_jobs" สำหรับ row-level gate,
// "customer_name"/"customer_phone" สำหรับ column-level filter ของข้อมูลลูกค้า)

const COLUMNS = [
  { key: "job_id", header: "job_id" },
  { key: "customer_name", header: "customer_name" },
  { key: "customer_phone", header: "customer_phone" },
  { key: "car_brand", header: "car_brand" },
  { key: "car_model", header: "car_model" },
  { key: "license_plate", header: "license_plate" },
  { key: "status", header: "status" },
  { key: "assignment_status", header: "assignment_status" },
  { key: "assigned_to", header: "assigned_to" },
  { key: "created_at", header: "created_at" },
  { key: "delivered_at", header: "delivered_at" },
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

    const { data: overrides } = await supabaseAdmin
      .from("shop_field_visibility_overrides")
      .select("role, field_group, allowed")
      .eq("shop_id", shopId);

    if (!canSeeField(callerMember.role, "export_csv_jobs", overrides || [])) {
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

    const { data: jobs, error: jobsError } = await supabaseAdmin
      .from("jobs")
      .select(
        "job_id, customer_name, customer_phone, car_brand, car_model, license_plate, status, assigned_to, created_at, closed_at"
      )
      .eq("shop_id", shopId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (jobsError) throw jobsError;

    const assignedUserIds = [...new Set((jobs || []).map((j) => j.assigned_to).filter(Boolean))];
    let memberByUserId = {};
    if (assignedUserIds.length > 0) {
      const { data: members } = await supabaseAdmin
        .from("shop_members")
        .select("user_id, contact_name, login_username")
        .eq("shop_id", shopId)
        .in("user_id", assignedUserIds);
      memberByUserId = Object.fromEntries(
        (members || []).map((m) => [m.user_id, m.contact_name || m.login_username || m.user_id])
      );
    }

    const rows = (jobs || []).map((j) => ({
      job_id: j.job_id,
      customer_name: canSeeCustomerName ? j.customer_name : null,
      customer_phone: canSeeCustomerPhone ? j.customer_phone : null,
      car_brand: j.car_brand,
      car_model: j.car_model,
      license_plate: j.license_plate,
      status: j.status,
      assignment_status: j.assigned_to ? "assigned" : "unassigned",
      assigned_to: j.assigned_to ? memberByUserId[j.assigned_to] || j.assigned_to : null,
      created_at: j.created_at,
      delivered_at: j.closed_at,
    }));

    const csv = toCsv(rows, COLUMNS);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="jobs-export-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
