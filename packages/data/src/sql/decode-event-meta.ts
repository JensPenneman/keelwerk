import type { EncodedDecisionRecord, EventMeta } from '@keelwerk/core';

/** The inverse of `encodeEventMeta`: what the `meta` column holds (JSON text or the parsed value) as the invocation's members. */
export function decodeEventMeta(value: unknown): EventMeta {
  const stored = (typeof value === 'string' ? JSON.parse(value) : value) as Omit<
    EventMeta,
    'decision'
  > & { readonly decision: EncodedDecisionRecord | null };
  const decision = stored.decision;
  if (decision === null) return { ...stored, decision: null };
  const { input, reads, ...rest } = decision;
  return {
    ...stored,
    decision: {
      ...rest,
      reads: reads.map((read) => ({ ...read, at: BigInt(read.at) })),
      ...(input === undefined
        ? {}
        : {
            input: {
              keyId: input.keyId,
              nonce: Uint8Array.from(Buffer.from(input.nonce, 'base64url')),
              ciphertext: Uint8Array.from(Buffer.from(input.ciphertext, 'base64url')),
            },
          }),
    },
  };
}
