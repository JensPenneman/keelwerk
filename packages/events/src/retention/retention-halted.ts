/** Thrown inside a pass once the worker stops: what is left is purged by the next pass. */
export class RetentionHalted extends Error {
  constructor() {
    super('The retention worker stopped before the pass was finished.');
    this.name = 'RetentionHalted';
  }
}
