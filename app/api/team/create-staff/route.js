import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdminClient";
import { verifyCaller, verifyShopManager, checkSeatLimit } from "../../../../lib/teamAuth";
import {
  STAFF_ROLES,
  isValidUsername,
  isValidPin,
  normalizeUsername,
  usernameToStaffEmail,
} from "../../../../lib/staffAuth";
import { getTierConfig, isUnlimited } from "../../../../config/subscriptionTiers";

export async function POST(request) {
  try {
    const authResult = await verifyCaller(request);
    if (authResult.error) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status });
    }
    const { userId } = authResult;

    const body = await request.json();
    const shopId = body.shop_id;
    const role = body.role;
    const username = normalizeUsername(body.username);
    const pin = (body.pin || "").trim();
    const contactName = (body.contact_name || "").trim();
    const contactPhone = (body.contact_phone || "").trim();
    const requestedBranchId = body.branch_id ?? null;
    // การ์ด "Field Scanner Role + temp account auto-expiry" — เฉพาะ role นี้เท่านั้นที่ตั้ง
    // วันหมดอายุได้ตอนสร้าง (บัญชีปกติอื่นๆ ไม่มีวันหมดอายุ)
    const expiresAt = role === "field_scanner" && body.expires_at ? body.expires_at : null;
    // การ์ด "Onboarding Burst Mode" — บัญชี field_scanner ที่มีวันหมดอายุ = บัญชีชั่วคราวของ Burst
    // Mode (Day 0 รุมเก็บข้อมูล) ไม่ใช่บัญชี field_scanner ถาวรทั่วไป
    const isBurstModeAccount = role === "field_scanner" && !!expiresAt;

    // 1) ตรวจสิทธิ์: owner/manager ของอู่นี้เท่านั้น — ต้องเช็คก่อน validation อื่นๆ ทั้งหมด
    // (bug fix: เดิมเช็ค field completeness ก่อน ทำให้ caller ที่ไม่มีสิทธิ์เห็น error "ข้อมูลไม่ครบ"
    // (400) แทนที่จะเจอ 403 ทันที — เป็นการรั่วข้อมูลเล็กน้อยว่า request ของเขาถูก parse ไปถึงจุดไหน
    // ก่อนจะโดนบล็อก จึงย้าย verifyShopManager มาไว้ก่อนสุด ทันทีหลัง verifyCaller)
    const managerCheck = await verifyShopManager(shopId, userId);
    if (managerCheck.error) {
      return NextResponse.json({ error: managerCheck.error }, { status: managerCheck.status });
    }

    // bug fix: เดิมใช้ !shopId ซึ่งเป็น falsy check — shop_id: 0 ก็เข้าเงื่อนไขนี้ (falsy-zero)
    // ทำให้ request ที่ส่ง shop_id: 0 โดนเด้ง 400 "ข้อมูลไม่ครบ" ทั้งที่ควรจะผ่านมาถึงตรงนี้ไม่ได้อยู่แล้ว
    // (เพราะ verifyShopManager ด้านบนจะดักด้วย 403 ก่อน) แต่เพื่อความถูกต้องของ validation เอง
    // เปลี่ยนมาเช็ค null/undefined ตรงๆ แทน ไม่ใช้ !shopId
    if (shopId == null || !role || !username || !pin || !contactName || !contactPhone) {
      return NextResponse.json({ error: "ข้อมูลไม่ครบ" }, { status: 400 });
    }
    if (!STAFF_ROLES.includes(role)) {
      return NextResponse.json(
        { error: "บทบาทนี้ต้องเชิญผ่านอีเมล ไม่ใช่ username+PIN" },
        { status: 400 }
      );
    }
    if (!isValidUsername(username)) {
      return NextResponse.json(
        { error: "username ต้องเป็นตัวอักษรเล็ก/ตัวเลข/จุด/ขีดล่าง ยาว 3-20 ตัว" },
        { status: 400 }
      );
    }
    if (!isValidPin(pin)) {
      return NextResponse.json({ error: "PIN/รหัสผ่านต้องเป็นตัวอักษรหรือตัวเลข ยาว 6-20 ตัว" }, { status: 400 });
    }

    // 2) ตรวจ tier limit — บัญชี Burst Mode (field_scanner ชั่วคราว) ไม่นับรวมกับที่นั่งปกติ
    // ("Day 0: อนุญาต temp login สูงสุด 20 บัญชี... ไม่ผูกกับ concurrent cap ปกติ" ในการ์ด — ขยาย
    // ความเดียวกันมาถึงที่นั่ง/roster cap ด้วย เพราะจุดประสงค์คือให้รุมเก็บข้อมูลได้โดยไม่ต้องไป
    // แย่งที่นั่งพนักงานถาวรของแพ็กเกจ — เป็นการตีความของเราเอง ไม่ใช่มติที่การ์ดระบุตรงๆ)
    let shopForBurstCheck = null;
    if (isBurstModeAccount) {
      const { data: shopRow, error: shopError } = await supabaseAdmin
        .from("shops")
        .select("subscription_plan")
        .eq("shop_id", shopId)
        .single();
      if (shopError) throw shopError;
      shopForBurstCheck = shopRow;

      // การ์ด "Onboarding Burst Mode" ✅ ตัดสินใจแล้ว (21 ก.ค. 2026): "20 บัญชี fix ทุก tier
      // ยกเว้น Enterprise ที่ configurable" — ย้ายมาอ่านจาก config/subscriptionTiers.js แทน
      // hardcode ในไฟล์นี้ตรงๆ (แก้ 22 ก.ค. 2026 — ของเดิม fix 20 ทุก tier ไม่เว้น Enterprise
      // เพราะตอนเขียนไฟล์นี้ครั้งแรก มติ Enterprise-configurable ยังไม่ถูกเคาะ)
      const burstModeMaxAccounts = getTierConfig(shopForBurstCheck?.subscription_plan)
        .burstModeMaxAccounts;
      if (!isUnlimited(burstModeMaxAccounts)) {
        const { count: burstCount, error: burstCountError } = await supabaseAdmin
          .from("shop_members")
          .select("member_id", { count: "exact", head: true })
          .eq("shop_id", shopId)
          .eq("role", "field_scanner")
          .not("expires_at", "is", null)
          .in("status", ["active", "invited"]);
        if (burstCountError) throw burstCountError;
        if ((burstCount || 0) >= burstModeMaxAccounts) {
          return NextResponse.json(
            { error: `บัญชีชั่วคราว Burst Mode เต็มโควตาแล้ว (สูงสุด ${burstModeMaxAccounts} บัญชี)` },
            { status: 400 }
          );
        }
      }
    } else {
      const seatCheck = await checkSeatLimit(shopId);
      if (!seatCheck.ok) {
        return NextResponse.json({ error: seatCheck.error }, { status: 400 });
      }
    }

    // burst_cycle_type จับภาพ plan ของร้าน ณ ตอนสร้างบัญชีนี้ครั้งเดียว (ดูหมายเหตุ assumption
    // เรื่อง Trial -> Paid ระหว่างรอบใน db/onboarding_burst_mode_migration.sql)
    const burstCycleType = isBurstModeAccount
      ? shopForBurstCheck?.subscription_plan === "trial"
        ? "trial"
        : "paid"
      : null;

    // 3) ตรวจ username ซ้ำ (unique ทั้งระบบ)
    const { data: existingUsername } = await supabaseAdmin
      .from("shop_members")
      .select("member_id")
      .eq("login_username", username)
      .maybeSingle();
    if (existingUsername) {
      return NextResponse.json({ error: "username นี้มีคนใช้แล้ว ลองชื่ออื่น" }, { status: 400 });
    }

    // 4) สร้างบัญชีจริงใน auth.users ด้วยอีเมลปลอม + email_confirm: true
    //    (ข้ามขั้นตอนยืนยันอีเมลไปเลย เพราะเจ้าของเป็นคน "ยืนยัน" แทนตั้งแต่สร้าง)
    const staffEmail = usernameToStaffEmail(username);
    const { data: createdUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: staffEmail,
      password: pin,
      email_confirm: true,
      user_metadata: { login_username: username, is_staff_account: true, full_name: contactName },
    });
    if (createError) {
      throw new Error(
        createError.message?.includes("already been registered")
          ? "username นี้ถูกใช้สร้างบัญชีไปแล้ว (ระบบภายใน) ลองชื่ออื่น"
          : createError.message
      );
    }

    // 5) การ์ด "Multi-branch support" — shop_members.branch_id เป็น NOT NULL แล้ว ต้อง resolve
    // ก่อน insert เสมอ ถ้าไม่ได้ระบุมา (ร้านสาขาเดียว 99%+ ของร้านตอนนี้) fallback ไปสาขา default
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

    // 6) สร้าง shop_members ผูกอู่ทันที (ไม่ต้องมีขั้นตอน invite/accept)
    const { data: member, error: memberError } = await supabaseAdmin
      .from("shop_members")
      .insert({
        shop_id: shopId,
        user_id: createdUser.user.id,
        role,
        status: "active",
        invited_by: userId,
        contact_name: contactName,
        contact_phone: contactPhone,
        login_username: username,
        expires_at: expiresAt,
        burst_cycle_type: burstCycleType,
        branch_id: resolvedBranchId,
      })
      .select()
      .single();

    if (memberError) {
      // rollback: ถ้าสร้าง shop_members ไม่สำเร็จ ลบ auth user ทิ้งกันเป็น orphan account
      await supabaseAdmin.auth.admin.deleteUser(createdUser.user.id);
      throw memberError;
    }

    return NextResponse.json({ data: member });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
