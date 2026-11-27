import type { StreamRef } from '@keelwerk/core';

/** The map key of a stream. */
export const streamKey = (stream: StreamRef): string => `${stream.type}\u0000${stream.id}`;
