import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller, getCallerShopRole } from "../../../../lib/teamAuth";
import { requirePlatformRole, logPlatformAction } from "../../../../lib/platformAdmin";

// Card: "Onboarding Burst Mode — Requester/Approver workflow"
// action "request": Manager (Requester) ขอต่ออายุบัญชี field_scanner ชั่วคราว (Burst Mode)
// action "respond": Owner (Approver) อนุมัติ/ปฏิเสธ — Manager approve คำขอตัวเองไม่ได้เด็ดขาด
// (ต้องเป็นคนละ role กันเสมอ — บังคับด้วย role check ตรงๆ ในนี้ ไม่ใช้แค่ RLS "owner/manager"
// รวมกันเพราะ RLS แยกสองฝั่งนี้ไม่ได้)
//
// ✅ เพิ่ม 22 ก.ค. 2026 (ตามมติการ์ด 21 ก.ค. 2026 — "Owner ไม่ตอบจนหมดเขต: Platform Admin กด
// ต่อแทนได้ — แต่ใช้สิทธิ์ 'ต่อได้ 1 รอบ' เดียวกับที่ Owner มี ไม่ใช่สิทธิ์เพิ่มพิเศษ + ต้องลง
// Platform admin audit log ระบุชัดว่า admin เป็นผู้กดแทน"): action "respond" ยอมรับทั้ง Owner
// ของอู่นั้น **หรือ** Platform Admin (super_admin/support — เหมือนเงื่อนไข join-as-support ไม่ใช่
// analyst เพราะ analyst read-only ล้วน) — จึงย้าย callerMembership lookup ให้ทำแบบ optional
// (ไม่ reject ทันทีถ้าไม่ใช่ shop member เพราะ platform admin ไม่ใช่ shop member ของอู่ลูกค้าเลย)
export async function POST(request) {
  try {
    const authResult = await verifyCaller(request);
    if (authResult.error) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { userId } = authResult;

    const body = await request.json();
    const { action, shop_id: shopId, member_id: memberId, request_id: requestId, decision } = body;

    // การ์ด "Multi-branch support" — .maybeSingle() เดิม throw ถ้า user นี้มีหลายแถวใน
    // shop_members ของ shop เดียวกัน (คนละสาขา) — เปลี่ยนมาใช้ getCallerShopRole() (role สูงสุด
    // ข้ามทุกสาขา) แทน ร้านสาขาเดียวพฤติกรรมเหมือนเดิมทุกประการ
    const callerRole = await getCallerShopRole(shopId, userId);
    const callerMembership = callerRole ? { role: callerRole } : null;

    if (action === "request" && !callerMembership) {
      return NextResponse.json({ error: "ไม่มีสิทธิ์จัดการอู่นี้" }, { status: 403 });
    }

    if (action === "request") {
      // เฉพาะ Manager เท่านั้นที่เป็น Requester ได้ (ตรงตามการ์ด "Manager = Requester")
      if (callerMembership.role !== "manager") {
        return NextResponse.json({ error: "เฉพาะผู้จัดการ (Manager) เท่านั้นที่ขอต่ออายุได้" }, { status: 403 });
      }

      const { data: member, error: memberError } = await supabaseAdmin
        .from("shop_members")
        .select("member_id, shop_id, role, expires_at, burst_extended")
        .eq("member_id", memberId)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (!member || member.role !== "field_scanner" || !member.expires_at) {
        return NextResponse.json({ error: "ไม่ใช่บัญชี Burst Mode ที่ขอต่ออายุได้" }, { status: 400 });
      }
      // ต่อได้ 1 รอบเท่านั้น (Trial +14, Paid +30) แล้วปิดถาวรตามการ์ด
      if (member.burst_extended) {
        return NextResponse.json({ error: "บัญชีนี้ต่ออายุไปแล้ว 1 ครั้ง ต่อเพิ่มไม่ได้อีก" }, { status: 400 });
      }

      const { data: existingPending } = await supabaseAdmin
        .from("burst_mode_extension_requests")
        .select("request_id")
        .eq("member_id", memberId)
        .eq("status", "pending")
        .maybeSingle();
      if (existingPending) {
        return NextResponse.json({ error: "มีคำขอต่ออายุค้างอยู่แล้ว รอ Owner ตอบก่อน" }, { status: 400 });
      }

      const { data: created, error: createError } = await supabaseAdmin
        .from("burst_mode_extension_requests")
        .insert({ shop_id: shopId, member_id: memberId, requested_by: userId })
        .select()
        .single();
      if (createError) throw createError;

      return NextResponse.json({ data: created });
    }

    if (action === "respond") {
      // เฉพาะ Owner เท่านั้นที่เป็น Approver ได้ — กัน Manager approve คำขอตัวเอง (ตรงตาม test
      // scenario ของการ์ด: "Manager approve คำขอตัวเอง -> reject") — หรือ Platform Admin กดแทนได้
      // (มติ 21 ก.ค. 2026) ถ้า Owner ไม่ตอบจนหมดเขต
      const isOwner = callerMembership?.role === "owner";
      let isPlatformAdminOverride = false;
      if (!isOwner) {
        const platformCheck = await requirePlatformRole(request, ["super_admin", "support"]);
        if (!platformCheck.error) {
          isPlatformAdminOverride = true;
        }
      }
      if (!isOwner && !isPlatformAdminOverride) {
        return NextResponse.json(
          { error: "เฉพาะเจ้าของอู่ (Owner) หรือ Platform Admin เท่านั้นที่อนุมัติ/ปฏิเสธได้" },
          { status: 403 }
        );
      }
      if (!["approved", "rejected"].includes(decision)) {
        return NextResponse.json({ error: "decision ต้องเป็น approved หรือ rejected" }, { status: 400 });
      }

      const { data: reqRow, error: reqError } = await supabaseAdmin
        .from("burst_mode_extension_requests")
        .select("request_id, member_id, shop_id, status")
        .eq("request_id", requestId)
        .eq("shop_id", shopId)
        .maybeSingle();
      if (reqError) throw reqError;
      if (!reqRow || reqRow.status !== "pending") {
        return NextResponse.json({ error: "ไม่พบคำขอที่ยัง pending อยู่" }, { status: 400 });
      }

      const { error: updateReqError } = await supabaseAdmin
        .from("burst_mode_extension_requests")
        .update({ status: decision, responded_by: userId, responded_at: new Date().toISOString() })
        .eq("request_id", requestId);
      if (updateReqError) throw updateReqError;

      if (decision === "approved") {
        const { data: member, error: memberError } = await supabaseAdmin
          .from("shop_members")
          .select("member_id, expires_at, burst_cycle_type, burst_extended")
          .eq("member_id", reqRow.member_id)
          .single();
        if (memberError) throw memberError;
        if (member.burst_extended) {
          return NextResponse.json({ error: "บัญชีนี้ต่ออายุไปแล้ว 1 ครั้ง ต่อเพิ่มไม่ได้อีก" }, { status: 400 });
        }

        // รอบแรก: Trial 14 วัน / Paid 30 วัน — ต่อเท่ากับความยาวรอบเดิม (Trial +14, Paid +30)
        const extendDays = member.burst_cycle_type === "trial" ? 14 : 30;
        const baseDate = member.expires_at ? new Date(member.expires_at) : new Date();
        const newExpiresAt = new Date(baseDate.getTime() + extendDays * 24 * 60 * 60 * 1000);

        const { error: extendError } = await supabaseAdmin
          .from("shop_members")
          .update({ expires_at: newExpiresAt.toISOString(), burst_extended: true })
          .eq("member_id", member.member_id);
        if (extendError) throw extendError;
      }

      if (isPlatformAdminOverride) {
        // ต้องลง Platform admin audit log ระบุชัดว่า admin เป็นผู้กดแทน ไม่ใช่ Owner กดเอง (มติการ์ด)
        await logPlatformAction({
          adminUserId: userId,
          adminRole: "platform_admin_override",
          action: "burst_mode_extension_override",
          status: "success",
          targetShopId: shopId,
          targetUserId: null,
          newData: { request_id: requestId, member_id: reqRow.member_id, decision },
        });
      }

      return NextResponse.json({ data: { status: decision, approved_by_platform_admin: isPlatformAdminOverride } });
    }

    return NextResponse.json({ error: "action ไม่ถูกต้อง" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
