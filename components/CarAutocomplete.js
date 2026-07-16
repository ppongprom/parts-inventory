"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * ค้นหารถจาก brand + model + generation_code รวมกัน จากฐานข้อมูลจริง
 * (model_generations_display view) — พิมพ์ 2 ตัวอักษรก็ค้นได้
 * เมื่อเลือกแล้วจะ callback (item) พร้อม year_range_display ที่ห้าม user พิมพ์เอง
 */
export default function CarAutocomplete({ onSelect, placeholder }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const debounceRef = useRef(null);
  const justSelectedRef = useRef(false); // กัน useEffect ค้นหาใหม่ทันทีหลังเพิ่งเลือกเสร็จ (setQuery ข้างล่างไปกระตุ้นมันโดยไม่ตั้งใจ)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // เพิ่งเลือกจาก dropdown มาเอง (ไม่ใช่ user พิมพ์เอง) ข้ามการค้นหารอบนี้ไปเลย
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
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
      let queryBuilder = supabase.from("model_generations_display").select("*");

      // แต่ละคำต้อง match กับ brand/model/generation_code อย่างน้อย 1 column
      // (การเรียก .or() หลายครั้งจะ AND กันเอง ทำให้ "byd atto" หาเจอได้
      //  แม้ยี่ห้อกับรุ่นจะอยู่คนละ column กัน)
      tokens.forEach((token) => {
        queryBuilder = queryBuilder.or(
          `brand_name.ilike.%${token}%,model_name.ilike.%${token}%,generation_code.ilike.%${token}%`
        );
      });

      const { data, error } = await queryBuilder.limit(10);

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
    justSelectedRef.current = true;
    setQuery(`${item.brand_name} ${item.model_name}`);
    setOpen(false);
    setActiveIndex(-1);
    setResults([]);
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
              key={item.generation_id}
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
                {item.generation_code ? ` (${item.generation_code})` : ""}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {item.vehicle_type} · {item.year_range_display}
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
          ไม่พบในฐานข้อมูล — พิมพ์ยี่ห้อ/รุ่นในช่องด้านล่างเองได้ (จะไม่มีข้อมูลปีให้)
        </div>
      )}
    </div>
  );
}
