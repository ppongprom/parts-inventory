"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "../../../lib/supabaseClient";
import { useAuth } from "../../../lib/AuthProvider";
import RequireAuth from "../../../components/RequireAuth";
import { hasFeature } from "../../../lib/featureGating";

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  };
}

const emptyGenForm = {
  generation_code: "",
  vehicle_type: "",
  year_start: "",
  year_start_approx: false,
  year_end: "",
  year_end_approx: false,
  is_current: false,
  note: "",
};

function CarDataAdminPageContent() {
  const { currentShop } = useAuth();
  const canSeeAuditLog = hasFeature(currentShop?.subscription_plan, "audit_log");

  const [brands, setBrands] = useState([]);
  const [selectedBrandId, setSelectedBrandId] = useState("");
  const [newBrandName, setNewBrandName] = useState("");

  const [models, setModels] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [newModelName, setNewModelName] = useState("");

  const [generations, setGenerations] = useState([]);
  const [genForm, setGenForm] = useState(emptyGenForm);
  const [editingGenId, setEditingGenId] = useState(null);

  const [auditOpenId, setAuditOpenId] = useState(null);
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchBrands();
  }, []);

  useEffect(() => {
    if (selectedBrandId) {
      fetchModels(selectedBrandId);
      setSelectedModelId("");
      setGenerations([]);
    } else {
      setModels([]);
    }
  }, [selectedBrandId]);

  useEffect(() => {
    if (selectedModelId) {
      fetchGenerations(selectedModelId);
    } else {
      setGenerations([]);
    }
  }, [selectedModelId]);

  async function fetchBrands() {
    const { data, error } = await supabase
      .from("brands")
      .select("*")
      .order("brand_name", { ascending: true });
    if (!error) setBrands(data || []);
  }

  async function fetchModels(brandId) {
    const { data, error } = await supabase
      .from("models")
      .select("*")
      .eq("brand_id", brandId)
      .order("model_name", { ascending: true });
    if (!error) setModels(data || []);
  }

  async function fetchGenerations(modelId) {
    const { data, error } = await supabase
      .from("model_generations")
      .select("*")
      .eq("model_id", modelId)
      .order("year_start", { ascending: true });
    if (!error) setGenerations(data || []);
  }

  async function handleAddBrand() {
    if (!newBrandName.trim()) return;
    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/car-generations", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({ mode: "get_or_create_brand", brand_name: newBrandName.trim() }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      setNewBrandName("");
      await fetchBrands();
      setSelectedBrandId(String(json.data));
      setMsg({ type: "success", text: "เพิ่มยี่ห้อแล้ว ✅" });
    } catch (err) {
      setMsg({ type: "error", text: "เพิ่มยี่ห้อไม่สำเร็จ: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddModel() {
    if (!newModelName.trim() || !selectedBrandId) return;
    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/car-generations", {
        method: "POST",
        headers: await getAuthHeaders(),
        body: JSON.stringify({
          mode: "get_or_create_model",
          brand_id: Number(selectedBrandId),
          model_name: newModelName.trim(),
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      setNewModelName("");
      await fetchModels(selectedBrandId);
      setSelectedModelId(String(json.data));
      setMsg({ type: "success", text: "เพิ่มรุ่นแล้ว ✅" });
    } catch (err) {
      setMsg({ type: "error", text: "เพิ่มรุ่นไม่สำเร็จ: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  function startEditGen(gen) {
    setEditingGenId(gen.generation_id);
    setGenForm({
      generation_code: gen.generation_code || "",
      vehicle_type: gen.vehicle_type || "",
      year_start: gen.year_start ?? "",
      year_start_approx: gen.year_start_approx,
      year_end: gen.year_end ?? "",
      year_end_approx: gen.year_end_approx,
      is_current: gen.is_current,
      note: gen.note || "",
    });
  }

  function startNewGen() {
    setEditingGenId("new");
    setGenForm(emptyGenForm);
  }

  function cancelGenForm() {
    setEditingGenId(null);
    setGenForm(emptyGenForm);
  }

  async function handleSaveGen() {
    if (!genForm.generation_code.trim()) {
      setMsg({ type: "error", text: "กรอกรหัส/ชื่อ generation ก่อน" });
      return;
    }

    setBusy(true);
    setMsg(null);

    const payload = {
      generation_code: genForm.generation_code.trim(),
      vehicle_type: genForm.vehicle_type.trim() || null,
      year_start: genForm.year_start ? Number(genForm.year_start) : null,
      year_start_approx: genForm.year_start_approx,
      year_end: genForm.is_current ? null : genForm.year_end ? Number(genForm.year_end) : null,
      year_end_approx: genForm.year_end_approx,
      is_current: genForm.is_current,
      note: genForm.note.trim() || null,
    };

    try {
      let res;
      if (editingGenId === "new") {
        res = await fetch("/api/car-generations", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({ mode: "insert", model_id: Number(selectedModelId), ...payload }),
        });
      } else {
        res = await fetch("/api/car-generations", {
          method: "POST",
          headers: await getAuthHeaders(),
          body: JSON.stringify({ mode: "update", generation_id: editingGenId, ...payload }),
        });
      }
      const json = await res.json();
      if (json.error) throw new Error(json.error);

      setMsg({ type: "success", text: "บันทึกแล้ว ✅" });
      cancelGenForm();
      fetchGenerations(selectedModelId);
    } catch (err) {
      setMsg({ type: "error", text: "บันทึกไม่สำเร็จ: " + err.message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleAudit(generationId) {
    if (auditOpenId === generationId) {
      setAuditOpenId(null);
      return;
    }
    setAuditOpenId(generationId);
    setAuditLoading(true);
    const { data, error } = await supabase
      .from("audit_log")
      .select("*")
      .eq("table_name", "model_generations")
      .eq("record_id", generationId)
      .order("changed_at", { ascending: false });
    if (!error) setAuditRows(data || []);
    setAuditLoading(false);
  }

  function formatYearRange(gen) {
    const start = gen.year_start_approx ? `~${gen.year_start}` : gen.year_start ?? "ไม่ทราบปี";
    const end = gen.is_current
      ? "ปัจจุบัน"
      : gen.year_end
      ? gen.year_end_approx
        ? `~${gen.year_end}`
        : gen.year_end
      : "ไม่ทราบปี";
    return `${start} - ${end}`;
  }

  return (
      <div className="container">
      <div className="header">
        <h1>🚗 จัดการข้อมูลรถ</h1>
        <Link href="/admin" className="nav-link secondary">
          ← กลับ
        </Link>
      </div>

      {msg && <div className={`msg ${msg.type}`} style={{ marginBottom: 16 }}>{msg.text}</div>}

      <label>
        1. ยี่ห้อ
        <select value={selectedBrandId} onChange={(e) => setSelectedBrandId(e.target.value)}>
          <option value="">— เลือกยี่ห้อ —</option>
          {brands.map((b) => (
            <option key={b.brand_id} value={b.brand_id}>
              {b.brand_name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="เพิ่มยี่ห้อใหม่"
          value={newBrandName}
          onChange={(e) => setNewBrandName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={handleAddBrand}
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
          + เพิ่ม
        </button>
      </div>

      {selectedBrandId && (
        <>
          <label>
            2. รุ่น
            <select value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
              <option value="">— เลือกรุ่น —</option>
              {models.map((m) => (
                <option key={m.model_id} value={m.model_id}>
                  {m.model_name}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <input
              type="text"
              placeholder="เพิ่มรุ่นใหม่"
              value={newModelName}
              onChange={(e) => setNewModelName(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleAddModel}
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
              + เพิ่ม
            </button>
          </div>
        </>
      )}

      {selectedModelId && (
        <>
          <h2 style={{ fontSize: 16, marginBottom: 10 }}>3. Generation / ช่วงปี</h2>

          {generations.map((gen) => (
            <div key={gen.generation_id} style={{ marginBottom: 10 }}>
              <div
                className="card"
                style={{ cursor: "default", alignItems: "center", justifyContent: "space-between" }}
              >
                <div className="card-body">
                  <div className="card-title">{gen.generation_code}</div>
                  <div className="card-sub">
                    {gen.vehicle_type} · {formatYearRange(gen)}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => startEditGen(gen)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--border-strong)",
                      background: "var(--surface)",
                      color: "var(--text)",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    แก้ไข
                  </button>
                  {canSeeAuditLog && (
                    <button
                      type="button"
                      onClick={() => toggleAudit(gen.generation_id)}
                      style={{
                        padding: "6px 12px",
                        borderRadius: 8,
                        border: "1px solid var(--border-strong)",
                        background: "var(--surface)",
                        color: "var(--link)",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      📜 ประวัติ
                    </button>
                  )}
                </div>
              </div>

              {auditOpenId === gen.generation_id && (
                <div
                  style={{
                    background: "var(--surface-dim)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 12,
                    marginTop: -4,
                    marginBottom: 8,
                    fontSize: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  {auditLoading && "กำลังโหลดประวัติ..."}
                  {!auditLoading && auditRows.length === 0 && "ยังไม่มีประวัติการแก้ไข"}
                  {!auditLoading &&
                    auditRows.map((a) => (
                      <div
                        key={a.audit_id}
                        style={{ paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid var(--border)" }}
                      >
                        <div>
                          <strong style={{ color: "var(--text)" }}>{a.action}</strong> —{" "}
                          {new Date(a.changed_at).toLocaleString("th-TH")}
                        </div>
                        <div>IP: {a.changed_by_ip || "ไม่ทราบ"}</div>
                        <div style={{ wordBreak: "break-all" }}>
                          Browser: {a.changed_by_user_agent || "ไม่ทราบ"}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}

          {generations.length === 0 && (
            <div className="empty" style={{ padding: 16 }}>
              ยังไม่มี generation สำหรับรุ่นนี้
            </div>
          )}

          {editingGenId === null && (
            <button
              type="button"
              onClick={startNewGen}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 8,
                border: "1px dashed var(--border-strong)",
                background: "var(--surface)",
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
                marginTop: 8,
              }}
            >
              + เพิ่ม Generation ใหม่
            </button>
          )}

          {editingGenId !== null && (
            <div
              style={{
                border: "1px solid var(--border-strong)",
                borderRadius: 8,
                padding: 16,
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <label>
                รหัส/ชื่อ generation *
                <input
                  type="text"
                  value={genForm.generation_code}
                  onChange={(e) => setGenForm((f) => ({ ...f, generation_code: e.target.value }))}
                  placeholder="เช่น AE111, gen 6, ACR50/GSR50"
                />
              </label>

              <label>
                ประเภทรถ
                <input
                  type="text"
                  value={genForm.vehicle_type}
                  onChange={(e) => setGenForm((f) => ({ ...f, vehicle_type: e.target.value }))}
                  placeholder="เช่น เก๋ง, SUV, MPV"
                />
              </label>

              <div style={{ display: "flex", gap: 8 }}>
                <label style={{ flex: 1 }}>
                  ปีเริ่ม
                  <input
                    type="number"
                    value={genForm.year_start}
                    onChange={(e) => setGenForm((f) => ({ ...f, year_start: e.target.value }))}
                  />
                </label>
                <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 22 }}>
                  <input
                    type="checkbox"
                    checked={genForm.year_start_approx}
                    onChange={(e) =>
                      setGenForm((f) => ({ ...f, year_start_approx: e.target.checked }))
                    }
                  />
                  <span style={{ fontSize: 13 }}>ประมาณ (~)</span>
                </label>
              </div>

              <label style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={genForm.is_current}
                  onChange={(e) => setGenForm((f) => ({ ...f, is_current: e.target.checked }))}
                />
                <span>ยังผลิตอยู่ถึงปัจจุบัน</span>
              </label>

              {!genForm.is_current && (
                <div style={{ display: "flex", gap: 8 }}>
                  <label style={{ flex: 1 }}>
                    ปีสิ้นสุด
                    <input
                      type="number"
                      value={genForm.year_end}
                      onChange={(e) => setGenForm((f) => ({ ...f, year_end: e.target.value }))}
                    />
                  </label>
                  <label style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 22 }}>
                    <input
                      type="checkbox"
                      checked={genForm.year_end_approx}
                      onChange={(e) =>
                        setGenForm((f) => ({ ...f, year_end_approx: e.target.checked }))
                      }
                    />
                    <span style={{ fontSize: 13 }}>ประมาณ (~)</span>
                  </label>
                </div>
              )}

              <label>
                หมายเหตุ
                <input
                  type="text"
                  value={genForm.note}
                  onChange={(e) => setGenForm((f) => ({ ...f, note: e.target.value }))}
                  placeholder="ไม่บังคับ"
                />
              </label>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleSaveGen}
                  disabled={busy}
                  style={{
                    flex: 1,
                    padding: 12,
                    borderRadius: 8,
                    border: "none",
                    background: "#2563eb",
                    color: "white",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {busy ? "กำลังบันทึก..." : "บันทึก"}
                </button>
                <button
                  type="button"
                  onClick={cancelGenForm}
                  style={{
                    padding: "0 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border-strong)",
                    background: "transparent",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          )}
        </>
      )}
      </div>
  );
}

export default function CarDataAdminPage() {
  return (
    <RequireAuth allowedRoles={["owner", "manager"]} requiredFeature="admin_basic">
      <CarDataAdminPageContent />
    </RequireAuth>
  );
}
