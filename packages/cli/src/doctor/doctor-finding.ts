/**
 * How serious a finding is: an error fails `keelwerk doctor`, a warning does not, a note informs.
 * `not-checked` says a check doctor has did not get a fact it needs on this run, with the reason;
 * it fails doctor only under `--strict`. A check that no source feeds is a note, never this.
 */
export type DoctorSeverity = 'error' | 'note' | 'not-checked' | 'warning';

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
