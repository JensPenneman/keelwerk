import type { DoctorFinding } from '../../doctor/doctor-finding.ts';

/** Findings as text: one block per finding with its fix, then a count. */
export function renderFindings(findings: readonly DoctorFinding[], layoutOnly: boolean): string {
  if (findings.length === 0) return layoutOnly ? 'layout: no findings' : 'doctor: no findings';
  const lines = findings.flatMap((finding) => [
    `${finding.severity} [${finding.check}] ${finding.subject}: ${finding.message}`,
    ...(finding.fix === '' ? [] : [`  fix: ${finding.fix}`]),
  ]);
  const count = (severity: DoctorFinding['severity']): number =>
    findings.filter((finding) => finding.severity === severity).length;
  lines.push(
    `${count('error')} error(s), ${count('warning')} warning(s), ${count('note')} note(s)`,
  );
  return lines.join('\n');
}
