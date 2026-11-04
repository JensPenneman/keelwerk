import type { DecisionRecord } from './decision-record.ts';

/** A decision record as `kw_events.meta` stores it (section 7.9.6): positions are decimal text, a sealed input's bytes are base64url. */
export interface EncodedDecisionRecord {
  readonly part: string;
  readonly inputDigest: string;
  readonly input?: { readonly keyId: string; readonly nonce: string; readonly ciphertext: string };
  readonly reads: readonly { readonly scope?: 'backend'; readonly at: string }[];
  readonly answers: DecisionRecord['answers'];
  readonly effects: readonly string[];
}

/**
 * The JSON form of a decision record, which is also what the chain hashes (section 15.1.8), so a
 * record read back from any adapter hashes as it did when written.
 */
export function encodeDecisionRecord(record: DecisionRecord): EncodedDecisionRecord {
  return {
    part: record.part,
    inputDigest: record.inputDigest,
    ...(record.input === undefined
      ? {}
      : {
          input: {
            keyId: record.input.keyId,
            nonce: Buffer.from(record.input.nonce).toString('base64url'),
            ciphertext: Buffer.from(record.input.ciphertext).toString('base64url'),
          },
        }),
    reads: record.reads.map((read) => ({
      ...(read.scope === undefined ? {} : { scope: read.scope }),
      at: read.at.toString(),
    })),
    answers: record.answers,
    effects: record.effects,
  };
}
