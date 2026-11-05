/** What one producer run left: the files it wrote, notes for the author, and the failures that make the run exit 1. */
export interface ProducerResult {
  /** Paths relative to the workspace root, in the order they were written. */
  readonly written: readonly string[];
  /** Lines that do not fail the run (a file that stays unmounted, a track that needs `db generate`). */
  readonly notes: readonly string[];
  /** One line per failure; the run is clean when there are none. */
  readonly failures: readonly string[];
}
