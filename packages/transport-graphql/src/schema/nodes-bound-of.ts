/** The most ids `nodes` takes in one request, and the most ids one loader sends in a batch. */
const nodesBound = 100;

/**
 * The most ids `nodes` takes in one request: a flat 100, whatever the entities allow. Each id is
 * one read, so the bound keeps the reads of a `nodes` field inside what the cost limit counts; the
 * loader of an entity splits its own ids at the page maximum of that entity.
 */
export function nodesBoundOf(): number {
  return nodesBound;
}
