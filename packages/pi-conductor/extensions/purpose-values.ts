import { Type } from "typebox";

export const EVIDENCE_BUNDLE_PURPOSES = ["task_review", "pr_readiness", "handoff"] as const;
export const READINESS_PURPOSES = ["task_review", "pr_readiness"] as const;

export type EvidenceBundlePurpose = (typeof EVIDENCE_BUNDLE_PURPOSES)[number];
export type ReadinessPurpose = (typeof READINESS_PURPOSES)[number];

export function acceptedPurposeValues(values: readonly string[]): string {
  return values.join(", ");
}

export function isEvidenceBundlePurpose(value: unknown): value is EvidenceBundlePurpose {
  return EVIDENCE_BUNDLE_PURPOSES.includes(value as EvidenceBundlePurpose);
}

export function isReadinessPurpose(value: unknown): value is ReadinessPurpose {
  return READINESS_PURPOSES.includes(value as ReadinessPurpose);
}

export function evidenceBundlePurposeSchema(description: string) {
  return Type.Union(
    [
      Type.Literal(EVIDENCE_BUNDLE_PURPOSES[0]),
      Type.Literal(EVIDENCE_BUNDLE_PURPOSES[1]),
      Type.Literal(EVIDENCE_BUNDLE_PURPOSES[2]),
    ],
    { description },
  );
}

export function readinessPurposeSchema(description: string) {
  return Type.Union([Type.Literal(READINESS_PURPOSES[0]), Type.Literal(READINESS_PURPOSES[1])], { description });
}
