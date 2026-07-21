"use client";

import RequireAuth from "../../../components/RequireAuth";
import LegalNav from "../../../components/LegalNav";
import LegalDoc from "../../../components/LegalDoc";
import { PRIVACY_CONTENT } from "../../../lib/legalContent";

export default function PrivacyPolicyPage() {
  return (
    <RequireAuth>
      <div className="container container-legal">
        <LegalNav />
        <LegalDoc content={PRIVACY_CONTENT} />
      </div>
    </RequireAuth>
  );
}
