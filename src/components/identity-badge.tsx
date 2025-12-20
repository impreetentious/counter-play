"use client";

import type { IdentityAttestation } from "@/engine/identity";

interface IdentityBadgeProps {
  attestations: readonly IdentityAttestation[];
  mode: "deterministic" | "stochastic";
  engineVersion: string;
}

export function IdentityBadge({ attestations, mode, engineVersion }: IdentityBadgeProps): React.JSX.Element {
  const allPass = attestations.every((item) => item.pass);
  const maxErr = attestations.reduce((peak, item) => Math.max(peak, item.maxErr), 0);
  return (
    <div className={allPass ? "identity-badge pass" : "identity-badge fail"} role="status" aria-live="polite">
      <span className="identity-mark" aria-hidden="true">{allPass ? "✓" : "✕"}</span>
      <span className="identity-title">Identity {allPass ? "attested" : "FAILED"}</span>
      <span className="identity-detail">
        {attestations.map((item) => `${item.id}${item.maxErr > 0 ? ` (Δ ${item.maxErr.toExponential(2)})` : ""}`).join(" · ")}
      </span>
      <span className="identity-stamp">mode {mode} · engine {engineVersion}{maxErr > 0 ? ` · max error ${maxErr.toExponential(2)}` : ""}</span>
    </div>
  );
}
