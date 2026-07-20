"use client";

import { useEffect, useState } from "react";
import { getChildren, isLeaf, getAncestorChain } from "../lib/zoneHelpers";

/**
 * เลือกโซนแบบไล่ชั้น Area → Rack → Level → ... ความลึกเท่าไหร่ก็ได้
 * บังคับเลือกจนถึง leaf เสมอ (ตามการตัดสินใจ: ถ้าอู่นี้แบ่งลึกแค่ไหน ต้องเลือกให้ถึงระดับนั้น —
 * ถ้า Area ไหนไม่มีลูกเลย Area นั้นเองก็คือ leaf เลือกได้ทันที)
 *
 * props:
 *  - zones: array ของ zones ทั้งหมดของร้าน (flat, มี id/parent_id/code/name)
 *  - value: zone_id ที่เลือกอยู่ตอนนี้ (หรือ null)
 *  - onChange(zoneId | null)
 *  - allowClear: แสดงตัวเลือก "ไม่ระบุโซน" ที่ระดับบนสุดหรือไม่ (default true)
 */
export default function ZoneCascadeSelect({ zones, value, onChange, allowClear = true }) {
  // steps[i] = zone_id ที่เลือกไว้ในระดับที่ i (0 = Area)
  const [steps, setSteps] = useState([]);

  // sync steps จาก value ที่ parent ส่งมา (เช่นตอนโหลดข้อมูลอะไหล่เดิมมาแก้ไข)
  useEffect(() => {
    if (value) {
      const chain = getAncestorChain(zones, value);
      setSteps(chain.map((z) => z.id));
    } else {
      setSteps([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, zones.length]);

  function handleStepChange(levelIndex, zoneId) {
    const newSteps = steps.slice(0, levelIndex);
    if (!zoneId) {
      setSteps(newSteps);
      onChange(newSteps.length ? newSteps[newSteps.length - 1] : null);
      return;
    }
    newSteps.push(zoneId);
    setSteps(newSteps);

    if (isLeaf(zones, zoneId)) {
      onChange(zoneId); // ถึง leaf แล้ว — นี่คือค่าที่ใช้จริง
    } else {
      onChange(null); // ยังไม่ถึง leaf ห้ามถือว่าเลือกเสร็จ ต้องไล่ต่อ
    }
  }

  const levels = [];
  let parentId = null;
  for (let i = 0; ; i++) {
    const options = getChildren(zones, parentId);
    if (options.length === 0) break;
    levels.push({ levelIndex: i, options, selected: steps[i] || "" });
    if (!steps[i]) break; // ยังไม่เลือกระดับนี้ หยุดไม่ต้องโชว์ระดับถัดไป
    parentId = steps[i];
  }

  const LEVEL_LABELS = ["โซน (Area)", "ชั้น/แร็ค (Rack)", "ระดับ (Level)"];
  const labelFor = (i) => LEVEL_LABELS[i] || `ระดับย่อย ${i + 1}`;

  if (levels.length === 0) {
    return (
      <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
        ยังไม่มีโซนในระบบ
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {levels.map(({ levelIndex, options, selected }) => (
        <label key={levelIndex}>
          {labelFor(levelIndex)}
          <select
            value={selected}
            onChange={(e) => handleStepChange(levelIndex, e.target.value || null)}
          >
            <option value="">{levelIndex === 0 && allowClear ? "ไม่ระบุโซน" : "— เลือก —"}</option>
            {options.map((z) => (
              <option key={z.id} value={z.id}>
                {z.code}
                {z.name ? ` — ${z.name}` : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
      {steps.length > 0 && !isLeaf(zones, steps[steps.length - 1]) && (
        <div style={{ fontSize: 12, color: "var(--warn-text, #b45309)" }}>
          เลือกต่อจนถึงระดับสุดท้าย (ยังมีโซนย่อยอยู่ข้างในอีก)
        </div>
      )}
    </div>
  );
}
