/** What a transport cannot project, as a named problem; any problem fails `generate` and boot (section 16.3.2). */
export interface TransportProblem {
  readonly code:
    | 'nameCollision'
    | 'reservedName'
    | 'routeConflict'
    | 'unsupportedShape'
    | (string & {});
  readonly transport: string;
  /** The entity or action reference. */
  readonly subject: string;
  /** Names the hint that resolves it. */
  readonly message: string;
}
