/**
 * The text the advisory lock of a FIFO key is hashed from. The one place that writes it: an enqueue
 * that appends under the key and every statement that ends the key's head or removes its jobs take
 * the same lock.
 */
export const jobKeyLockText = (root: string, laneId: string, key: string): string =>
  `${root}:${laneId}:${key}`;
