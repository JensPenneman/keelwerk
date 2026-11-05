/** A program and its arguments. */
export interface ChildCommandLine {
  readonly command: string;
  readonly args: readonly string[];
}
