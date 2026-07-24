import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller, verifyShopManager, checkSeatLimit } from "../../../../lib/teamAuth";
import { EMAIL_INVITE_ROLES } from "../../../../lib/staffAuth";

// ส่งคำเชิญใหม่ + ส่งอีเมลเชิญจริงผ่าน Supabase Auth (inviteUserByEmail)
// ⚠️ ใช้ได้เฉพาะบทบาท "manager" เท่านั้น — หัวหน้างาน/ช่าง/ผู้ช่วยช่าง
// ให้ใช้ /api/team/create-staff (ระบบ username+PIN แทน ไม่ต้องมีอีเมล)
export async function POST(request) {
  try {
    const authResult = await verifyCaller(request);
    if (authResult.error) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { userId } = authResult;

    const body = await request.json();
    const shopId = body.shop_id;
    const email = (body.email || "").trim().toLowerCase();
    const role = body.role;
    const requestedBranchId = body.branch_id ?? null;

    // ตรวจสิทธิ์ก่อน validation อื่นๆ ทั้งหมด (bug fix: เดิมเช็ค field completeness ก่อน
    // ทำให้ caller ที่ไม่มีสิทธิ์เห็น 400 "ข้อมูลไม่ครบ" แทนที่จะเจอ 403 ทันที)
    const managerCheck = await verifyShopManager(shopId, userId);
    if (managerCheck.error) {
      return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });
    }

    // bug fix: เดิมใช้ !shopId (falsy check) — shop_id: 0 จะโดนเด้ง 400 ก่อนถึง authz check ด้านบน
    // เปลี่ยนมาเช็ค null/undefined ตรงๆ แทน
    if (shopId == null || !email || !role) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบ (shop_id/email/role)" }, { status: 400 });
    }
    if (!EMAIL_INVITE_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "บทบาทนี้ไม่ได้เชิญผ่านอีเมล ใช้ระบบ username+PIN แทน" },
        { status: 400 }
      );
    }

    const seatCheck = await checkSeatLimit(shopId, email);
    if (!seatCheck.ok) {
      return NextResponse.json({ error: seatCheck.error }, { status: 400 });
    }
    const { shop } = seatCheck;

    // การ์ด "Multi-branch support" — คำเชิญตอนนี้ผูกกับสาขาได้ (role ต่อสาขา) ถ้าไม่ได้ระบุ
    // branch_id มา (ร้านสาขาเดียว 99%+ ของร้านตอนนี้) fallback ไปสาขา default ของร้านอัตโนมัติ —
    // transparent default เหมือน call site อื่นๆ ทั้งหมดในฟีเจอร์นี้
    let resolvedBranchId = requestedBranchId;
    if (resolvedBranchId == null) {
      const { data: defaultBranch, error: branchLookupError } = await supabaseAdmin
        .from("branches")
        .select("branch_id")
        .eq("shop_id", shopId)
        .eq("is_default", true)
        .maybeSingle();
      if (branchLookupError) throw branchLookupError;
      resolvedBranchId = defaultBranch?.branch_id ?? null;
    }

    // บันทึกคำเชิญลง shop_invites (upsert เหมือน RPC create_shop_invite เดิม)
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("shop_invites")
      .upsert(
        { shop_id: shopId, email, role, invited_by: userId, accepted_at: null, branch_id: resolvedBranchId },
        { onConflict: "shop_id,email" }
      )
      .select()
      .single();
    if (inviteError) throw inviteError;

    // ส่งอีเมลเชิญจริงผ่าน Supabase Auth Admin API
    // ลิงก์ในอีเมลจะพาไปที่ /signup?invite=<invite_id> พร้อม session ที่ login ให้อัตโนมัติ
    const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_SITE_URL || "";
    const { error: mailError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/signup?invite=${invite.invite_id}`,
      data: { invited_shop_name: shop.shop_name, invited_role: role },
    });

    if (mailError) {
      // ถ้าเป็นเพราะมี user นี้อยู่แล้วในระบบ (สมัครไว้ก่อนหน้า) inviteUserByEmail จะ error
      // แต่คำเชิญใน shop_invites ยังบันทึกไว้แล้ว -> ให้แจ้งผู้ใช้บอกด้วยตัวเองแทน
      return NextResponse.json({
        data: invite,
        warning:
          "บันทึกคำเชิญไว้แล้ว แต่ส่งอีเมลอัตโนมัติไม่สำเร็จ (" +
          mailError.message +
          ") — อาจเป็นเพราะอีเมลนี้มีบัญชีอยู่แล้ว กรุณาแจ้งผู้ถูกเชิญให้เข้าสู่ระบบแล้วเข้าหน้า /signup เอง",
      });
    }

    return NextResponse.json({ data: invite });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
