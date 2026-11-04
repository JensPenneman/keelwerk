import type { StreamRef } from '@keelwerk/core';

/** One string per stream, for maps keyed by stream. */
export function sqlStreamKey(stream: StreamRef): string {
  return `${stream.type}\u0000${stream.id}`;
}
