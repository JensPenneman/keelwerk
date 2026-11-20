import type { EncodedDecisionRecord, EventMeta } from '@keelwerk/core';

/** The inverse of `encodeEventMeta`: what the `meta` column holds (JSON text or the parsed value) as the invocation's members. */
export function decodeEventMeta(value: unknown): EventMeta {
  const stored = (typeof value === 'string' ? JSON.parse(value) : value) as Omit<
    EventMeta,
    'decision'
  > & { readonly decision: EncodedDecisionRecord | null };
  const decision = stored.decision;
  if (decision === null) return { ...stored, decision: null };
  const { input, reads, prepare, ...rest } = decision;
  return {
    ...stored,
    decision: {
      ...rest,
      reads: reads.map((read) => ({ ...read, at: BigInt(read.at) })),
      ...(prepare === undefined
        ? {}
        : {
            // Member by member: a member this release does not declare (a digest an earlier
            // checkpoint stored, or one a foreign writer added) never reaches a reader of the record.
            prepare: {
              reads: prepare.reads.map((read) => ({
                ...(read.scope === undefined ? {} : { scope: read.scope }),
                at: BigInt(read.at),
              })),
              answers: prepare.answers,
              effects: [...prepare.effects],
            },
          }),
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
