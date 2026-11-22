import type { DoctorFinding } from '../../doctor/doctor-finding.ts';

/** Whether doctor exits 1: a finding is an error, or, with `--strict`, a check that doctor has did not run. */
export function doctorFails(
  parsed: Readonly<Record<string, unknown>>,
  findings: readonly DoctorFinding[],
): boolean {
  const strict = parsed.strict === true;
  return findings.some(
    (finding) => finding.severity === 'error' || (strict && finding.severity === 'not-checked'),
  );
}
