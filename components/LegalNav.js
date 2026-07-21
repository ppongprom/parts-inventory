"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LEGAL_DOCS } from "../lib/legalContent";

export default function LegalNav() {
  const pathname = usePathname();

  return (
    <nav className="legal-nav no-print">
      {LEGAL_DOCS.map((doc) => (
        <Link
          key={doc.key}
          href={doc.path}
          className={`legal-nav-tab ${pathname === doc.path ? "legal-nav-tab--active" : ""}`}
        >
          {doc.label}
        </Link>
      ))}
    </nav>
  );
}
