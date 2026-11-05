import type { LayoutFinding } from '../layout/layout-finding.ts';
import type { DoctorFinding } from './doctor-finding.ts';
import { findingOf } from './finding-of.ts';

/** The layout pass's findings as doctor findings: each is an error, named `layout/<kind>`. */
export function layoutFindingsOf(findings: readonly LayoutFinding[]): readonly DoctorFinding[] {
  return findings.map((finding) =>
    findingOf(`layout/${finding.kind}`, 'error', finding.path, finding.message, finding.fix),
  );
}
