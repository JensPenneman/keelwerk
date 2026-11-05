/** How serious a finding is: an error fails `keelwerk doctor`, a warning does not, a note informs. */
export type DoctorSeverity = 'error' | 'note' | 'warning';

/** One thing doctor found, with the fix it names. Doctor never edits. */
export interface DoctorFinding {
  /** The check that found it: `environment`, `tsconfig`, `layout`, `deployment`, ... */
  readonly check: string;
  readonly severity: DoctorSeverity;
  /** What it is about: a file, a package, a placement, a queue, a scope. */
  readonly subject: string;
  readonly message: string;
  readonly fix: string;
}
