/** One check of `keelwerk build` (section 13.8): a command to run in the workspace root. */
export interface BuildStep {
  /** The step's number in section 13.8 and what it checks. */
  readonly title: string;
  readonly command: string;
  readonly args: readonly string[];
}
