/** What running one of the workspace's generator scripts with `--check` answered. */
export interface ArtefactRun {
  readonly code: number;
  readonly output: string;
}
