import type { DecisionRecord, EventMeta } from '@keelwerk/core';

interface StoredRead {
  readonly scope?: 'backend';
  readonly at: string;
}

interface StoredInput {
  readonly keyId: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

interface StoredDecision extends Omit<DecisionRecord, 'reads' | 'input'> {
  readonly reads: readonly StoredRead[];
  readonly input?: StoredInput;
}

/** The inverse of `encodeEventMeta`: what the `meta` column holds (JSON text or the parsed value) as the invocation's members. */
export function decodeEventMeta(value: unknown): EventMeta {
  const stored = (typeof value === 'string' ? JSON.parse(value) : value) as Omit<
    EventMeta,
    'decision'
  > & { readonly decision: StoredDecision | null };
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
