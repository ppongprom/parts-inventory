import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller } from "../../../../lib/teamAuth";

export async function POST(request) {
  try {
    const authResult = await verifyCaller(request);
    if (authResult.error) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { userId } = authResult;

    const body = await request.json();
    const shopId = body.shop_id;

    // ตรวจสิทธิ์ก่อน validation อื่นๆ (bug fix: เดิมเช็ค field completeness ก่อน ทำให้ caller
    // ที่ไม่มีสิทธิ์เห็น 400 "ข้อมูลไม่ครบ" แทนที่จะเจอ 403 ทันที): ต้องเป็นสมาชิก active ของอู่นี้
    // เท่านั้น (ทุกบทบาทดูรายชื่อได้ แค่แก้ไม่ได้)
    // การ์ด "Multi-branch support" — user อาจมีหลายแถวใน shop_members ของ shop เดียวกันได้แล้ว
    // (คนละสาขา) แค่ต้องการเช็ค "เป็นสมาชิก active อยู่บ้างไหม" ไม่ได้ต้องการ role เฉพาะ ใช้
    // .limit(1) แทน .maybeSingle() (ซึ่งจะ throw ถ้าเจอมากกว่า 1 แถว)
    const { data: callerMembershipRows } = await supabaseAdmin
      .from("shop_members")
      .select("member_id")
      .eq("shop_id", shopId)
      .eq("user_id", userId)
      .eq("status", "active")
      .limit(1);

    if (!callerMembershipRows || callerMembershipRows.length === 0) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์ดูรายชื่อทีมของอู่นี้" }, { status: 403 });
    }

    // bug fix: เดิมใช้ !shopId (falsy check) — shop_id: 0 จะโดนเด้ง 400 ก่อนถึง authz check ด้านบน
    // เปลี่ยนมาเช็ค null/undefined ตรงๆ แทน
    if (shopId == null) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }

    const { data: members, error } = await supabaseAdmin
      .from("shop_members")
      .select(
        "member_id, role, status, login_username, contact_name, user_id, expires_at, burst_cycle_type, burst_extended"
      )
      .eq("shop_id", shopId)
      .neq("status", "removed") // ซ่อนคนที่ถูกลบออกจากรายการนี้ (ข้อมูลยังอยู่ครบ)
      .order("member_id");

    if (error) throw error;

    // การ์ด "Onboarding Burst Mode" — ดึงคำขอต่ออายุที่ยัง pending มาผูกกับสมาชิกแต่ละคนด้วย
    // เพื่อให้หน้า /admin/team โชว์ปุ่ม "อนุมัติ/ปฏิเสธ" (Owner) หรือสถานะ "รออนุมัติ" (Manager) ได้
    const { data: pendingRequests } = await supabaseAdmin
      .from("burst_mode_extension_requests")
      .select("request_id, member_id, status")
      .eq("shop_id", shopId)
      .eq("status", "pending");

    // ดึงอีเมลของแต่ละคนจาก auth.users มาผูกเพิ่ม (ต้องใช้ admin API ทีละคน)
    const withEmails = await Promise.all(
      (members || []).map(async (m) => {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(m.user_id);
        const pendingRequest = (pendingRequests || []).find((r) => r.member_id === m.member_id) || null;
        return { ...m, email: userData?.user?.email || null, pending_extension_request: pendingRequest };
      })
    );

    return NextResponse.json({ data: withEmails });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
