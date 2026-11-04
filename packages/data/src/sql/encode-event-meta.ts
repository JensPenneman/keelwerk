import type { EventMeta } from '@keelwerk/core';

/**
 * The `meta` column of an event as JSON text (15.1.2): the invocation's members as they are, except
 * the two values JSON cannot carry. A recorded read's position (`decision.reads[].at`) is a decimal
 * string, and a sealed decision input keeps its key id and writes its nonce and ciphertext as
 * base64url. `decodeEventMeta` is the inverse.
 */
export function encodeEventMeta(meta: EventMeta): string {
  const decision = meta.decision;
  const stored =
    decision === null
      ? meta
      : {
          ...meta,
          decision: {
            ...decision,
            reads: decision.reads.map((read) => ({ ...read, at: read.at.toString() })),
            ...(decision.input === undefined
              ? {}
              : {
                  input: {
                    keyId: decision.input.keyId,
                    nonce: Buffer.from(decision.input.nonce).toString('base64url'),
                    ciphertext: Buffer.from(decision.input.ciphertext).toString('base64url'),
                  },
                }),
          },
        };
  return JSON.stringify(stored);
}
