/** Runs a program without a shell; a non-zero exit is a result, never a throw. */
export type ProcessRun = (
  program: string,
  args: readonly string[],
) => Promise<{ readonly code: number; readonly output: string }>;
