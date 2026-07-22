"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * ค้นหารถจาก brand + model + generation_code + trim (ถ้ามี) รวมกัน
 * จากฐานข้อมูลจริง (car_search_display view) — พิมพ์ 2 ตัวอักษรก็ค้นได้
 * ถ้ารุ่นนั้นมีรุ่นย่อยอยู่ในฐานข้อมูล จะโชว์เป็นตัวเลือกแยกให้เลือกตรงๆ ในช่องนี้เลย
 * ไม่ต้องมี dropdown เลือกรุ่นย่อยแยกต่างหากอีกขั้น
 * เมื่อเลือกแล้วจะ callback (item) พร้อม year_range_display/trim_id ที่ห้าม user พิมพ์เอง
 */
export default function CarAutocomplete({ onSelect, placeholder }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);
  const skipNextSearchRef = useRef(false);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (skipNextSearchRef.current) {
      // query เพิ่งถูกเซ็ตจาก handleSelect (ไม่ใช่ผู้ใช้พิมพ์) — ไม่ต้อง search ซ้ำ
      // ป้องกัน false "ไม่พบในฐานข้อมูล" เมื่อ model_name/trim_name มีอักขระ
      // ที่เป็น reserved character ใน PostgREST filter syntax เช่น "Yaris (XP150)"
      skipNextSearchRef.current = false;
      return;
    }

    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);

      const tokens = q.split(/\s+/).filter(Boolean);
      let queryBuilder = supabase.from("car_search_display").select("*");

      // แต่ละคำต้อง match กับ brand/model/generation_code/trim_name อย่างน้อย 1 column
      // (การเรียก .or() หลายครั้งจะ AND กันเอง ทำให้ "byd atto" หาเจอได้
      //  แม้ยี่ห้อกับรุ่นจะอยู่คนละ column กัน)
      tokens.forEach((token) => {
        // token ที่เป็นตัวเลขล้วนสั้นๆ (1-3 หลัก) ไม่ match กับ generation_code
        // เพราะ generation_code มักเก็บช่วงปี (เช่น "1996-ปัจจุบัน") ทำให้ token
        // อย่าง "1" หรือ "2" ไป match ปีของรุ่นอื่นโดยบังเอิญแทบทุกรุ่น แล้วดัน
        // ผลลัพธ์ที่ผู้ใช้ต้องการ (เช่น "1-Series") ตกขอบ LIMIT ไป
        // ยังคง match generation_code ตามปกติถ้า token มีตัวอักษรปน (เช่น "F20", "GJ")
        const isShortNumericToken = /^\d{1,3}$/.test(token);
        queryBuilder = isShortNumericToken
          ? queryBuilder.or(
              `brand_name.ilike.%${token}%,model_name.ilike.%${token}%,trim_name.ilike.%${token}%`
            )
          : queryBuilder.or(
              `brand_name.ilike.%${token}%,model_name.ilike.%${token}%,generation_code.ilike.%${token}%,trim_name.ilike.%${token}%`
            );
      });

      const { data, error } = await queryBuilder
        // เรียงตาม brand → model → generation ก่อน เพื่อให้ trim ของรุ่นเดียวกัน
        // อยู่ติดกันเป็นกลุ่มเสมอ (เดิมเรียงแค่ trim_id ซึ่งเป็นลำดับการเพิ่มข้อมูล
        // ดิบๆ ทำให้ trim ของรุ่นเดียวกันกระจายไปมาไม่เป็นกลุ่มถ้า trim_id ห่างกันมาก)
        .order("brand_name", { ascending: true })
        .order("model_name", { ascending: true })
        .order("generation_id", { ascending: true })
        .order("trim_id", { ascending: true, nullsFirst: true })
        .limit(15);

      if (!error) setResults(data || []);
      setLoading(false);
    }, 250);

    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSelect(item) {
    onSelect(item);
    skipNextSearchRef.current = true;
    setQuery(
      `${item.brand_name} ${item.model_name}${item.trim_name ? ` ${item.trim_name}` : ""}`
    );
    setOpen(false);
    setResults([]);
    setActiveIndex(-1);
  }

  function handleKeyDown(e) {
    if (!open || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0) handleSelect(results[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative", width: "50%", minWidth: 220 }}>
      <input
        type="text"
        value={query}
        placeholder={placeholder || "พิมพ์ยี่ห้อหรือรุ่น เช่น Camry, Vios, D-Max"}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        style={{ width: "100%", boxSizing: "border-box" }}
      />

      {open && loading && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--text-muted)",
            zIndex: 20,
          }}
        >
          กำลังค้นหา...
        </div>
      )}

      {open && !loading && results.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            maxHeight: 260,
            overflowY: "auto",
            zIndex: 20,
          }}
        >
          {results.map((item, i) => (
            <div
              key={`${item.generation_id}-${item.trim_id ?? "none"}`}
              onClick={() => handleSelect(item)}
              style={{
                padding: "10px 12px",
                cursor: "pointer",
                background: i === activeIndex ? "var(--surface-alt)" : "transparent",
                borderBottom:
                  i !== results.length - 1 ? "1px solid var(--border)" : "none",
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {item.brand_name} {item.model_name}
                {item.trim_name ? ` · ${item.trim_name}` : ""}
                {item.powertrain_type ? ` [${item.powertrain_type}]` : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {item.generation_code ? `${item.generation_code} · ` : ""}
                {item.vehicle_type} · {item.year_range_display}
                {!item.trim_name ? " · ไม่ระบุรุ่นย่อย" : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {open && !loading && query.trim().length >= 2 && results.length === 0 && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 13,
            color: "var(--text-muted)",
            zIndex: 20,
          }}
        >
          ไม่พบในฐานข้อมูล — แจ้งแอดมินให้เพิ่มยี่ห้อ/รุ่นนี้ในฐานข้อมูลก่อน เพื่อกันข้อมูลปี/รุ่นเพี้ยน
        </div>
      )}
    </div>
  );
}
