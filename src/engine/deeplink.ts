import type { Finding } from "./linter";
import type { DeepLink } from "./types";

/** §4.8 registry for the interactive "Show me" target on each linter finding. */
export function deepLinkFor(
  finding: Pick<Finding, "type" | "segments" | "plans" | "evidence">,
): DeepLink {
  const segment = finding.segments[0] ?? "";
  switch (finding.type) {
    case "L-1":
      return {
        surface: "design",
        chart: "payout-curve",
        highlight: {
          from_lo: String(finding.evidence.zone_lo_pct),
          from_hi: String(finding.evidence.zone_hi_pct),
        },
      };
    case "L-2":
      return {
        surface: "design",
        chart: "payout-curve",
        highlight: { threshold: String(finding.evidence.x_b_pct) },
      };
    case "L-3":
      return {
        surface: "design",
        chart: "payout-curve",
        highlight: { cap: String(finding.evidence.x_bar_pct) },
      };
    case "L-4":
      return { surface: "simulate", chart: "response-table", highlight: { segment } };
    case "L-5":
      return finding.segments.length > 0
        ? { surface: "simulate", chart: "response-table", highlight: { segment } }
        : {
            surface: "simulate",
            chart: "compare-overlay",
            highlight: { plans: (finding.plans ?? []).join(",") },
          };
    case "L-6":
      return {
        surface: "design",
        chart: "payout-curve",
        highlight: { output: String(finding.evidence.q_flip_currency), segment },
      };
    case "L-7":
      return {
        surface: "analyze",
        chart: "timing-table",
        highlight: { segment, z_star: String(finding.evidence.z_star_currency) },
      };
    case "L-8":
      return { surface: "analyze", chart: "horizon-table", highlight: { segment } };
    case "L-9":
      return { surface: "analyze", chart: "team-table", highlight: { segment } };
    case "L-10":
      return {
        surface: "simulate",
        chart: "sorting-map",
        highlight: { segment, kind: String(finding.evidence.kind) },
      };
  }
}
