"use client";

import RequireAuth from "../../../components/RequireAuth";
import LegalNav from "../../../components/LegalNav";
import LegalDoc from "../../../components/LegalDoc";
import { TOS_CONTENT } from "../../../lib/legalContent";

export default function TosPage() {
  return (
    <RequireAuth>
      <div className="container container-legal">
        <LegalNav />
        <LegalDoc content={TOS_CONTENT} />
      </div>
    </RequireAuth>
  );
}
