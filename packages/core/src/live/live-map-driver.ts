/**
 * Drives the generator a map answered for one item; the answer is the mapped item (`undefined` drops
 * it). `stopped` aborts the unit when the stream it belongs to ends.
 */
export type LiveMapDriver = (
  generator: Generator<unknown, unknown, unknown>,
  stopped?: AbortSignal,
) => Promise<unknown>;
