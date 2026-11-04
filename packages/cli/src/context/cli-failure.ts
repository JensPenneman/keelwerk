import type { WireError } from '@keelwerk/core';

/** What a command ends with when it cannot succeed: a wire error, a usage mistake or an interrupt. */
export type CliOutcome = WireError | 'usage' | 'interrupted';

/** Thrown inside the CLI to end a command with an exit code; the runner renders it once. */
export class CliFailure extends Error {
  readonly outcome: CliOutcome;

  constructor(outcome: CliOutcome, message: string) {
    super(message);
    this.name = 'CliFailure';
    this.outcome = outcome;
  }
}
