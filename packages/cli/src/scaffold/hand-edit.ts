/** What only a hand-written file can hold: the file, why, and the lines to add (decision 59b). */
export interface HandEdit {
  readonly file: string;
  readonly reason: string;
  readonly lines: readonly string[];
}
