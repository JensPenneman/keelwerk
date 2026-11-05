import type { DoctorFinding, DoctorSeverity } from './doctor-finding.ts';

/** A finding, written as one call. */
export function findingOf(
  check: string,
  severity: DoctorSeverity,
  subject: string,
  message: string,
  fix: string,
): DoctorFinding {
  return { check, severity, subject, message, fix };
}
