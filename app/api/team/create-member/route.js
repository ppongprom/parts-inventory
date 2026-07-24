import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { getCallerShopRole } from "../../../../lib/teamAuth";

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({ error: "ไม่พบ token กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });
    }

    // ยืนยันตัวตนคนเรียก (ต้อง login อยู่)
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return NextResponse.json({ error: "session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่" }, { status: 401 });
    }

    const body = await request.json();
    const { shop_id, email, password, role, contact_name, branch_id } = body;

    // เช็คว่าคนเรียกเป็น owner/manager ของอู่นี้จริง (ข้าม RLS เพราะใช้ service role
    // จึงต้องเช็คสิทธิ์เองตรงนี้แทน แทนที่ RLS ปกติ) — ทำก่อน validation อื่นๆ ทั้งหมด
    // (bug fix: เดิมเช็ค field completeness ก่อน ทำให้ caller ที่ไม่มีสิทธิ์เห็น 400 "ข้อมูลไม่ครบ"
    // แทนที่จะเจอ 403 ทันที)
    // การ์ด "Multi-branch support" — user อาจมีหลายแถวใน shop_members ของ shop เดียวกันได้แล้ว
    // (คนละสาขา) ใช้ getCallerShopRole() (role สูงสุดข้ามทุกสาขา) แทน .maybeSingle() เดิม
    const callerRole = await getCallerShopRole(shop_id, callerData.user.id);

    if (!callerRole || !["owner", "manager"].includes(callerRole)) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์สร้างสมาชิกในอู่นี้" }, { status: 403 });
    }

    // bug fix: เดิมใช้ !shop_id (falsy check) — shop_id: 0 จะโดนเด้ง 400 ก่อนถึง authz check ด้านบน
    // เปลี่ยนมาเช็ค null/undefined ตรงๆ แทน
    if (shop_id == null || !email || !password || !role) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }

    if (role === "owner") {
      return NextResponse.json({ error: "สร้างสมาชิกระดับเจ้าของแบบนี้ไม่ได้" }, { status: 400 });
    }

    // สร้าง auth user ใหม่ทันที พร้อม email_confirm: true = ข้ามขั้นตอนยืนยันอีเมลไปเลย
    // ใส่ full_name ไว้ด้วยเผื่ออยากเห็น Display name ใน Supabase Dashboard
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: contact_name ? { full_name: contact_name } : undefined,
    });

    if (createError) throw createError;

    // การ์ด "Multi-branch support" — shop_members.branch_id เป็น NOT NULL แล้ว ทุกแถวต้องผูก
    // กับสาขาใดสาขาหนึ่งเสมอ ถ้า caller ไม่ได้ระบุ branch_id มา (ร้านสาขาเดียว 99%+ ของร้านตอนนี้)
    // ให้ fallback ไปที่สาขา default ของร้านโดยอัตโนมัติ (transparent default ตามที่การ์ดขอ —
    // "avoid making every existing call site pass a new required branch_id parameter")
    let resolvedBranchId = branch_id;
    if (resolvedBranchId == null) {
      const { data: defaultBranch, error: branchLookupError } = await supabaseAdmin
        .from("branches")
        .select("branch_id")
        .eq("shop_id", shop_id)
        .eq("is_default", true)
        .maybeSingle();
      if (branchLookupError) throw branchLookupError;
      resolvedBranchId = defaultBranch?.branch_id ?? null;
    }

    // เพิ่มเข้าทีมทันที เป็น active เลย ไม่ต้องผ่านขั้นตอนคำเชิญ/ยืนยัน
    const { error: memberError } = await supabaseAdmin.from("shop_members").insert({
      shop_id,
      user_id: newUser.user.id,
      role,
      status: "active",
      invited_by: callerData.user.id,
      contact_name: contact_name || null,
      branch_id: resolvedBranchId,
    });

    if (memberError) {
      // rollback: ถ้าสร้าง shop_members ไม่สำเร็จ ลบ auth user ทิ้งกันเป็น orphan account
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
      throw memberError;
    }

    return NextResponse.json({ data: { user_id: newUser.user.id, email } });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
