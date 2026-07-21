"use client";

import RequireAuth from "../../../components/RequireAuth";
import LegalNav from "../../../components/LegalNav";
import LegalDoc from "../../../components/LegalDoc";
import { DPP_CONTENT } from "../../../lib/legalContent";

export default function DataProcessingPolicyPage() {
  return (
    <RequireAuth>
      <div className="container container-legal">
        <LegalNav />
        <LegalDoc content={DPP_CONTENT} />
      </div>
    </RequireAuth>
  );
}
