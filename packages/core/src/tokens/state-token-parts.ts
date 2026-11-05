/** The parts of a state token (section 15.2.6). */
export interface StateTokenParts {
  readonly epoch: number;
  readonly position: bigint;
  readonly scope: string;
  readonly check: string;
}
