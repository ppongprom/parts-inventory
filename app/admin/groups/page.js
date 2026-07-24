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

function GroupsPageContent() {
  const { currentShopId, currentRole } = useAuth();

  const [groups, setGroups] = useState([]);
  const [members, setMembers] = useState([]);
  const [groupMembers, setGroupMembers] = useState({}); // { group_id: [user_id, ...] }
  const [newGroupName, setNewGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const canManage = currentRole === "owner" || currentRole === "manager";

  useEffect(() => {
    if (currentShopId) fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentShopId]);

  async function fetchAll() {
    setLoading(true);
    const [groupsRes, membersRes] = await Promise.all([
      supabase.from("visibility_groups").select("*").eq("shop_id", currentShopId).order("created_at"),
      supabase
        .from("shop_members")
        .select("user_id, role, contact_name, login_username")
        .eq("shop_id", currentShopId)
        .eq("status", "active"),
    ]);

    const groupList = groupsRes.data || [];
    setGroups(groupList);
    setMembers(membersRes.data || []);

    if (groupList.length > 0) {
      const { data: gm } = await supabase
        .from("visibility_group_members")
        .select("group_id, user_id")
        .in("group_id", groupList.map((g) => g.group_id));

      const map = {};
      (gm || []).forEach((row) => {
        if (!map[row.group_id]) map[row.group_id] = [];
        map[row.group_id].push(row.user_id);
      });
      setGroupMembers(map);
    }

    setLoading(false);
  }

  async function handleCreateGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) return;

    setBusy(true);
    const { error } = await supabase
      .from("visibility_groups")
      .insert({ shop_id: currentShopId, name: newGroupName.trim() });

    if (error) {
      setMsg({ type: "error", text: "สร้างกลุ่มไม่สำเร็จ: " + error.message });
    } else {
      setNewGroupName("");
      fetchAll();
    }
    setBusy(false);
  }

  async function handleDeleteGroup(groupId) {
    const confirmed = window.confirm("ลบกลุ่มนี้ใช่ไหม? งานที่ผูกกลุ่มนี้ไว้จะกลับมาเห็นได้ทุกคนแทน");
    if (!confirmed) return;

    setBusy(true);
    const { error } = await supabase.from("visibility_groups").delete().eq("group_id", groupId);
    if (error) {
      setMsg({ type: "error", text: "ลบไม่สำเร็จ: " + error.message });
    } else {
      fetchAll();
    }
    setBusy(false);
  }

  async function toggleMember(groupId, userId) {
    const isMember = (groupMembers[groupId] || []).includes(userId);
    setBusy(true);

    if (isMember) {
      await supabase
        .from("visibility_group_members")
        .delete()
        .eq("group_id", groupId)
        .eq("user_id", userId);
    } else {
      await supabase.from("visibility_group_members").insert({ group_id: groupId, user_id: userId });
    }

    await fetchAll();
    setBusy(false);
  }

  function memberLabel(m) {
    return m.contact_name || m.login_username || ROLE_LABELS[m.role] || m.user_id.slice(0, 8);
  }

  return (
    <div className="container">
      <div className="header">
        <h1>🧑‍🤝‍🧑 กลุ่มผู้ใช้</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        สร้างกลุ่มตามสาขา/ความชำนาญ (เช่น "ช่างเครื่อง", "ช่างสี", "ช่างไฟฟ้า" — เพิ่มได้เรื่อยๆ ไม่จำกัด) แล้วกำหนดตอนรับงานว่าให้กลุ่มไหนเห็นงานนั้นบ้าง (เลือกได้มากกว่า 1 กลุ่มต่องาน) — เจ้าของ/ผู้จัดการเห็นทุกงานเสมอไม่ว่าจะอยู่กลุ่มไหน
      </p>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      {!canManage && (
        <div className="msg error" style={{ marginBottom: 16 }}>
          เฉพาะเจ้าของ/ผู้จัดการเท่านั้นที่จัดการกลุ่มได้
        </div>
      )}

      {canManage && (
        <form onSubmit={handleCreateGroup} style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="ชื่อกลุ่มใหม่ เช่น ช่างเครื่อง, ช่างสี, ช่างไฟฟ้า"
            style={{ flex: 1 }}
          />
          <button
            type="submit"
            disabled={busy}
            style={{
              padding: "0 16px",
              borderRadius: 8,
              border: "none",
              background: "#2563eb",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + สร้างกลุ่ม
          </button>
        </form>
      )}

      {loading && <div className="empty">กำลังโหลด...</div>}
      {!loading && groups.length === 0 && <div className="empty">ยังไม่มีกลุ่ม — งานทุกงานจะเห็นได้ทุกคนตามปกติ</div>}

      {groups.map((g) => (
        <div
          key={g.group_id}
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <div style={{ fontWeight: 700 }}>👥 {g.name}</div>
            {canManage && (
              <button
                type="button"
                onClick={() => handleDeleteGroup(g.group_id)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--danger-border)",
                  background: "transparent",
                  color: "var(--danger-text)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                ลบกลุ่ม
              </button>
            )}
          </div>

          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>สมาชิกในกลุ่ม</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {members.map((m) => {
              const isMember = (groupMembers[g.group_id] || []).includes(m.user_id);
              return (
                <button
                  key={m.user_id}
                  type="button"
                  disabled={!canManage || busy}
                  onClick={() => toggleMember(g.group_id, m.user_id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 20,
                    border: "1px solid var(--border-strong)",
                    background: isMember ? "#2563eb" : "var(--surface)",
                    color: isMember ? "white" : "var(--text)",
                    fontSize: 12,
                    cursor: canManage ? "pointer" : "default",
                  }}
                >
                  {isMember ? "✓ " : ""}
                  {memberLabel(m)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function GroupsPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager", "supervisor", "technician", "assistant"]} requiredFeature="admin_basic">
      <GroupsPageContent />
    </RequireAuth>
  );
}
