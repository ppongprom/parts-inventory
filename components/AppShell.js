"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "../lib/AuthProvider";
import { useTheme } from "../lib/ThemeProvider";

const NAV_ITEMS = [
  { href: "/jobs", label: "งานเข้าอู่", icon: "🔧" },
  { href: "/", label: "สต็อกอะไหล่", icon: "📦" },
  { href: "/admin", label: "ตั้งค่า", icon: "⚙️" },
];

const REPORTS_ITEM = { href: "/admin/reports", label: "รายงานการขาย", icon: "📊" };

const CHEVRON_DELAYS_LIGHT = [0, 0.24, 0.48]; // leftmost fires first → left-to-right
const CHEVRON_DELAYS_DARK = [0.48, 0.24, 0]; // rightmost fires first → right-to-left

function ThemeSwitchArrow({ theme }) {
  const chevron = theme === "light" ? "▶" : "◀";
  const delays = theme === "light" ? CHEVRON_DELAYS_LIGHT : CHEVRON_DELAYS_DARK;
  return (
    <span className="app-theme-switch-arrow">
      {delays.map((d, i) => (
        <span key={i} className="app-theme-switch-chevron" style={{ animationDelay: `${d}s` }}>
          {chevron}
        </span>
      ))}
    </span>
  );
}

function isActive(pathname, href) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export default function AppShell({ children, title }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const { currentShop, currentShopId, memberships, switchShop, currentRole, signOut, user } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const canSeeReports = currentRole === "owner" || currentRole === "manager";
  const navItems = canSeeReports ? [...NAV_ITEMS, REPORTS_ITEM] : NAV_ITEMS;
  const hasMultipleShops = memberships.length > 1;

  return (
    <div className="app-shell">
      {/* มือถือ: แถบบนสุด */}
      <div className="app-topbar no-print">
        <button
          type="button"
          className="app-hamburger"
          aria-label="เปิดเมนู"
          onClick={() => setMobileOpen(true)}
        >
          ☰
        </button>
        <span className="app-topbar-title">
          {title || currentShop?.shop_name || "สต็อกอะไหล่รถ"}
        </span>
        <Link href="/add" className="app-topbar-add" aria-label="เพิ่มอะไหล่">
          +
        </Link>
      </div>

      {mobileOpen && (
        <div className="app-sidebar-backdrop no-print" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`app-sidebar no-print ${mobileOpen ? "app-sidebar--open" : ""}`}>
        <div className="app-sidebar-header">
          <span className="app-sidebar-logo">📦 {currentShop?.shop_name || "สต็อกอะไหล่รถ"}</span>
          <button
            type="button"
            className="app-sidebar-close"
            aria-label="ปิดเมนู"
            onClick={() => setMobileOpen(false)}
          >
            ✕
          </button>
        </div>

        <Link href="/add" className="app-sidebar-cta" onClick={() => setMobileOpen(false)}>
          + เพิ่มอะไหล่
        </Link>

        {hasMultipleShops && (
          <div style={{ padding: "8px 12px 4px" }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)", display: "block", marginBottom: 4 }}>
              🏢 กำลังดูอู่
            </label>
            <select
              value={currentShopId || ""}
              onChange={(e) => switchShop(Number(e.target.value))}
              style={{ width: "100%", fontSize: 13, padding: "6px 8px" }}
            >
              {memberships.map((m) => (
                <option key={m.shop_id} value={m.shop_id}>
                  {m.shop_name || `อู่ #${m.shop_id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <nav className="app-sidebar-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`app-sidebar-link ${isActive(pathname, item.href) ? "app-sidebar-link--active" : ""}`}
              onClick={() => setMobileOpen(false)}
            >
              <span className="app-sidebar-link-icon">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="app-sidebar-footer">
          <Link href="/legal/tos" className="app-sidebar-legal-link" onClick={() => setMobileOpen(false)}>
            ToS
          </Link>
          <div className="app-sidebar-footer-divider">
            <button
              type="button"
              role="switch"
              aria-checked={theme === "dark"}
              className={`app-theme-switch ${theme === "dark" ? "app-theme-switch--on" : ""}`}
              onClick={toggleTheme}
            >
              <ThemeSwitchArrow theme={theme} />
              <span className="app-theme-switch-text">{theme === "light" ? "Dark" : "Light"}</span>
            </button>
            <div className="app-sidebar-role">
              บทบาท: {currentRole}
              <br />
              {currentShop?.contact_name || currentShop?.login_username || user?.email || "-"}
            </div>
            <button type="button" className="app-sidebar-signout" onClick={signOut}>
              ออกจากระบบ
            </button>
          </div>
        </div>
      </aside>

      <main className="app-main">{children}</main>
    </div>
  );
}
