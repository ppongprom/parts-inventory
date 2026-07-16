"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";

const ROLE_LABELS = {
  owner: "เจ้าของ",
  manager: "ผู้จัดการ",
  supervisor: "หัวหน้างาน",
  technician: "ช่าง",
  assistant: "ผู้ช่วยช่าง",
};

const INVITABLE_ROLES = ["manager", "supervisor", "technician", "assistant"];
const STAFF_ROLES = ["supervisor", "technician", "assistant"];

function generateRandomPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let pass = "";
  for (let i = 0; i < 10; i++) {
    pass += chars[Math.floor(Math.random() * chars.length)];
  }
  return pass;
}

function generateRandomPin() {
  let pin = "";
  for (let i = 0; i < 6; i++) {
    pin += Math.floor(Math.random() * 10);
  }
  return pin;
}

function TeamPageContent() {
  const { currentShopId, currentRole } = useAuth();

  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("technician");

  // ฟอร์มสร้างบัญชีทันที (ไม่ต้องผ่านอีเมลยืนยัน)
  const [directEmail, setDirectEmail] = useState("");
  const [directPassword, setDirectPassword] = useState(generateRandomPassword());
  const [directRole, setDirectRole] = useState("technician");
  const [creatingDirect, setCreatingDirect] = useState(false);
  const [createdCredential, setCreatedCredential] = useState(null);

  // ฟอร์มสร้างบัญชีพนักงานแบบ username + PIN (ไม่ต้องใช้อีเมลเลย)
  const [staffUsername, setStaffUsername] = useState("");
  const [staffPin, setStaffPin] = useState(generateRandomPin());
  const [staffRole, setStaffRole] = useState("technician");
  const [staffContactName, setStaffContactName] = useState("");
  const [staffContactPhone, setStaffContactPhone] = useState("");
  const [creatingStaff, setCreatingStaff] = useState(false);
  const [createdStaffCredential, setCreatedStaffCredential] = useState(null);

  useEffect(() => {
    if (currentShopId) fetchTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function fetchTeam() {
    setLoading(true);
    const [membersRes, invitesRes] = await Promise.all([
      supabase
        .from("shop_members")
        .select("member_id, role, status, user_id")
        .eq("shop_id", currentShopId),
      supabase
        .from("shop_invites")
        .select("*")
        .eq("shop_id", currentShopId)
        .is("accepted_at", null),
    ]);
    setMembers(membersRes.data || []);
    setInvites(invitesRes.data || []);
    setLoading(false);
  }

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setBusy(true);
    setMsg(null);

    const { error } = await supabase.rpc("create_shop_invite", {
      p_shop_id: currentShopId,
      p_email: inviteEmail.trim(),
      p_role: inviteRole,
    });

    if (error) {
      setMsg({ type: "error", text: "เชิญไม่สำเร็จ: " + error.message });
    } else {
      setMsg({ type: "success", text: `ส่งคำเชิญไปที่ ${inviteEmail} แล้ว ✅` });
      setInviteEmail("");
      fetchTeam();
    }
    setBusy(false);
  }

  async function handleCreateDirect(e) {
    e.preventDefault();
    if (!directEmail.trim() || !directPassword.trim()) return;

    setCreatingDirect(true);
    setMsg(null);
    setCreatedCredential(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/team/create-member", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          shop_id: currentShopId,
          email: directEmail.trim(),
          password: directPassword,
          role: directRole,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "เกิดข้อผิดพลาด");

      setCreatedCredential({ email: directEmail.trim(), password: directPassword });
      setMsg({ type: "success", text: "สร้างบัญชีสำเร็จ ✅ — คัดลอกข้อมูลด้านล่างไปให้พนักงานได้เลย" });
      setDirectEmail("");
      setDirectPassword(generateRandomPassword());
      fetchTeam();
    } catch (err) {
      setMsg({ type: "error", text: "สร้างบัญชีไม่สำเร็จ: " + err.message });
    } finally {
      setCreatingDirect(false);
    }
  }

  async function handleCreateStaff(e) {
    e.preventDefault();
    if (!staffUsername.trim() || !staffPin.trim() || !staffContactName.trim() || !staffContactPhone.trim()) return;

    setCreatingStaff(true);
    setMsg(null);
    setCreatedStaffCredential(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/team/create-staff", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          shop_id: currentShopId,
          role: staffRole,
          username: staffUsername.trim(),
          pin: staffPin,
          contact_name: staffContactName.trim(),
          contact_phone: staffContactPhone.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "เกิดข้อผิดพลาด");

      setCreatedStaffCredential({ username: staffUsername.trim(), pin: staffPin });
      setMsg({ type: "success", text: "สร้างบัญชีพนักงานสำเร็จ ✅ — บอก username+PIN นี้ให้พนักงานไปเข้า /staff-login" });
      setStaffUsername("");
      setStaffPin(generateRandomPin());
      setStaffContactName("");
      setStaffContactPhone("");
      fetchTeam();
    } catch (err) {
      setMsg({ type: "error", text: "สร้างบัญชีไม่สำเร็จ: " + err.message });
    } finally {
      setCreatingStaff(false);
    }
  }

  async function handleRoleChange(memberId, newRole) {
    setBusy(true);
    const { error } = await supabase.rpc("update_member_role", {
      p_member_id: memberId,
      p_new_role: newRole,
      p_new_status: "active",
    });
    if (error) {
      setMsg({ type: "error", text: "แก้ไขไม่สำเร็จ: " + error.message });
    } else {
      fetchTeam();
    }
    setBusy(false);
  }

  async function handleDisable(memberId) {
    const confirmed = window.confirm("ปิดการใช้งานสมาชิกคนนี้ใช่ไหม?");
    if (!confirmed) return;

    setBusy(true);
    const member = members.find((m) => m.member_id === memberId);
    const { error } = await supabase.rpc("update_member_role", {
      p_member_id: memberId,
      p_new_role: member.role,
      p_new_status: "disabled",
    });
    if (error) {
      setMsg({ type: "error", text: "ดำเนินการไม่สำเร็จ: " + error.message });
    } else {
      fetchTeam();
    }
    setBusy(false);
  }

  const canManage = currentRole === "owner" || currentRole === "manager";

  return (
      <div className="container">
      <div className="header">
        <h1>👥 จัดการทีม</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {!canManage && (
        <div className="msg error" style={{ marginBottom: 16 }}>
          เฉพาะเจ้าของ/ผู้จัดการเท่านั้นที่จัดการทีมได้ — คุณดูได้อย่างเดียว
        </div>
      )}

      {canManage && (
        <>
          {/* ================= สร้างบัญชีพนักงานแบบ username + PIN (แนะนำสำหรับหัวหน้างาน/ช่าง/ผู้ช่วยช่าง) ================= */}
          <div
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>🔑 สร้างบัญชีพนักงาน (Username + PIN)</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              แนะนำสำหรับหัวหน้างาน/ช่าง/ผู้ช่วยช่าง — ไม่ต้องมีอีเมลเลย พนักงานเข้าผ่านหน้า{" "}
              <code>/staff-login</code> ด้วย username + PIN เท่านั้น
            </div>

            <form onSubmit={handleCreateStaff}>
              <label>
                Username (ตัวพิมพ์เล็ก/ตัวเลข/จุด/ขีดล่าง 3-20 ตัว ไม่ซ้ำใครทั้งระบบ)
                <input
                  type="text"
                  value={staffUsername}
                  onChange={(e) => setStaffUsername(e.target.value)}
                  placeholder="เช่น chang01"
                  required
                />
              </label>
              <label>
                PIN (ตัวอักษร/ตัวเลข 4-20 ตัว)
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={staffPin}
                    onChange={(e) => setStaffPin(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setStaffPin(generateRandomPin())}
                    style={{
                      padding: "0 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border-strong)",
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🎲 สุ่มใหม่
                  </button>
                </div>
              </label>
              <label>
                ชื่อ-นามสกุล
                <input
                  type="text"
                  value={staffContactName}
                  onChange={(e) => setStaffContactName(e.target.value)}
                  placeholder="เช่น สมชาย ใจดี"
                  required
                />
              </label>
              <label>
                เบอร์โทร
                <input
                  type="tel"
                  value={staffContactPhone}
                  onChange={(e) => setStaffContactPhone(e.target.value)}
                  placeholder="เช่น 081-234-5678"
                  required
                />
              </label>
              <label>
                บทบาท
                <select value={staffRole} onChange={(e) => setStaffRole(e.target.value)}>
                  {STAFF_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={creatingStaff}>
                {creatingStaff ? "กำลังสร้าง..." : "+ สร้างบัญชีพนักงาน"}
              </button>
            </form>

            {createdStaffCredential && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--surface-dim)",
                  fontSize: 13,
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  📋 ส่งข้อมูลนี้ให้พนักงาน (จะไม่แสดงซ้ำอีก จดไว้ก่อนปิดหน้านี้):
                </div>
                <div>Username: <strong>{createdStaffCredential.username}</strong></div>
                <div>PIN: <strong>{createdStaffCredential.pin}</strong></div>
                <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
                  ให้พนักงานเข้า <code>/staff-login</code> แล้วกรอก username+PIN นี้
                </div>
              </div>
            )}
          </div>

          {/* ================= สร้างบัญชีทันที (ไม่ต้องผ่านอีเมลยืนยัน) ================= */}
          <div
            style={{
              border: "1px solid var(--border-strong)",
              borderRadius: 8,
              padding: 16,
              marginBottom: 20,
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>⚡ สร้างบัญชีให้ทันที</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              ใช้ได้ทันทีไม่ต้องผ่านอีเมลยืนยัน เหมาะกับพนักงานที่ไม่มี/ไม่สะดวกใช้อีเมล —
              ตั้งอีเมลอะไรก็ได้ที่ไม่ซ้ำใคร (ไม่จำเป็นต้องเป็นอีเมลจริงที่เปิดได้) แล้วส่งรหัสผ่านให้พนักงานเองทาง LINE/บอกปากเปล่า
            </div>

            <form onSubmit={handleCreateDirect}>
              <label>
                อีเมล/ชื่อผู้ใช้ (ไม่ซ้ำใคร)
                <input
                  type="text"
                  value={directEmail}
                  onChange={(e) => setDirectEmail(e.target.value)}
                  placeholder="เช่น somchai@อู่ของฉัน.local หรืออีเมลจริงก็ได้"
                  required
                />
              </label>
              <label>
                รหัสผ่าน
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={directPassword}
                    onChange={(e) => setDirectPassword(e.target.value)}
                    required
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    onClick={() => setDirectPassword(generateRandomPassword())}
                    style={{
                      padding: "0 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border-strong)",
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontSize: 13,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    🎲 สุ่มใหม่
                  </button>
                </div>
              </label>
              <label>
                บทบาท
                <select value={directRole} onChange={(e) => setDirectRole(e.target.value)}>
                  {INVITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={creatingDirect}>
                {creatingDirect ? "กำลังสร้าง..." : "+ สร้างบัญชีทันที"}
              </button>
            </form>

            {createdCredential && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 8,
                  background: "var(--surface-dim)",
                  fontSize: 13,
                }}
              >
                <div style={{ marginBottom: 4 }}>
                  📋 ส่งข้อมูลนี้ให้พนักงาน (จะไม่แสดงซ้ำอีก จดไว้ก่อนปิดหน้านี้):
                </div>
                <div>อีเมล/ชื่อผู้ใช้: <strong>{createdCredential.email}</strong></div>
                <div>รหัสผ่าน: <strong>{createdCredential.password}</strong></div>
              </div>
            )}
          </div>

          {/* ================= เชิญแบบเดิม (ต้องสมัคร/ยืนยันอีเมลเอง) ================= */}
          <div style={{ marginBottom: 12, fontWeight: 700 }}>✉️ หรือเชิญด้วยอีเมล (ต้องยืนยันเอง)</div>
          <form onSubmit={handleInvite} style={{ marginBottom: 24 }}>
            <label>
              อีเมลที่จะเชิญ
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                required
              />
            </label>
            <label>
              บทบาท
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              {busy ? "กำลังเชิญ..." : "+ เชิญเข้าอู่"}
            </button>
          </form>
        </>
      )}

      {loading && <div className="empty">กำลังโหลด...</div>}

      <h2 style={{ fontSize: 16, marginBottom: 10 }}>สมาชิกปัจจุบัน</h2>
      {members.map((m) => (
        <div
          className="card"
          key={m.member_id}
          style={{ cursor: "default", alignItems: "center", justifyContent: "space-between" }}
        >
          <div className="card-body">
            <div className="card-title">{ROLE_LABELS[m.role]}</div>
            <div className="card-sub">{m.status === "disabled" ? "🚫 ปิดใช้งานแล้ว" : "✅ ใช้งานอยู่"}</div>
          </div>
          {canManage && m.role !== "owner" && (
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              <select
                value={m.role}
                onChange={(e) => handleRoleChange(m.member_id, e.target.value)}
                disabled={busy}
                style={{ fontSize: 12, padding: 8 }}
              >
                {INVITABLE_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
              {m.status !== "disabled" && (
                <button
                  type="button"
                  onClick={() => handleDisable(m.member_id)}
                  disabled={busy}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 8,
                    border: "1px solid var(--danger-border)",
                    background: "transparent",
                    color: "var(--danger-text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  ปิดใช้งาน
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {invites.length > 0 && (
        <>
          <h2 style={{ fontSize: 16, margin: "20px 0 10px" }}>คำเชิญที่ยังไม่ตอบรับ</h2>
          {invites.map((inv) => (
            <div className="card" key={inv.invite_id} style={{ cursor: "default" }}>
              <div className="card-body">
                <div className="card-title">{inv.email}</div>
                <div className="card-sub">รอตอบรับเป็น {ROLE_LABELS[inv.role]}</div>
              </div>
            </div>
          ))}
        </>
      )}
      </div>
  );
}

export default function TeamPage() {
  return (
    <RequireAuth>
      <TeamPageContent />
    </RequireAuth>
  );
}
