"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * เลือกรุ่นย่อย (trim) แยกจากกล่องค้นหารถหลัก — โผล่ให้เลือกก็ต่อเมื่อ
 * generation ที่เลือกไว้มี trim อยู่จริงในฐานข้อมูล (เช่น ORA Good Cat มี 400/500/GT)
 * ไม่บังคับเลือก
 *
 * Props:
 *  - generationId: generation ที่เลือกอยู่ตอนนี้ (จาก CarAutocomplete)
 *  - initialTrimId: ใช้ตอนแก้ไขอะไหล่เดิมที่เคยผูก trim ไว้แล้ว
 *  - onChange(trim | null): trim = { trim_id, trim_name, powertrain_type }
 */
export default function TrimSelect({ generationId, initialTrimId, onChange }) {
  const [trims, setTrims] = useState([]);
  const [trimId, setTrimId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setTrimId("");
    setTrims([]);

    if (!generationId) {
      onChange(null);
      return;
    }

    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("model_trims")
        .select("trim_id, trim_name, powertrain_type")
        .eq("generation_id", generationId)
        .order("trim_name");
      if (!active) return;
      setTrims(data || []);
      setLoading(false);

      const preselect = (data || []).find((t) => String(t.trim_id) === String(initialTrimId));
      if (preselect) {
        setTrimId(String(preselect.trim_id));
        onChange(preselect);
      } else {
        onChange(null);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generationId]);

  if (loading) {
    return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>กำลังเช็ครุ่นย่อย...</div>;
  }

  if (trims.length === 0) return null;

  return (
    <label>
      รุ่นย่อย (ไม่บังคับ)
      <select
        value={trimId}
        onChange={(e) => {
          const val = e.target.value;
          setTrimId(val);
          const trim = trims.find((t) => String(t.trim_id) === val);
          onChange(trim || null);
        }}
      >
        <option value="">— ไม่ระบุรุ่นย่อย —</option>
        {trims.map((t) => (
          <option key={t.trim_id} value={t.trim_id}>
            {t.trim_name}
            {t.powertrain_type ? ` [${t.powertrain_type}]` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
