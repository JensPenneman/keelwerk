import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import type { FoundEnvelope } from './erasure-envelopes.ts';

/**
 * What the dump after the erasure is searched with, for the personal values that live in derived
 * data (WP-130).
 */
interface DerivedDataEvidence {
  /** The dump after the erasure, as text. */
  readonly after: string;
  /** The plain fingerprint of each planted command, by name. */
  readonly fingerprints: ReadonlyMap<string, string>;
  /** The commands planted, by name, with their input. */
  readonly planted: ReadonlyMap<string, { readonly action: string; readonly input: unknown }>;
  /** The markers of the erased subject. */
  readonly erasedMarkers: readonly string[];
  /** The tables each command's plain fingerprint is still found in, by name. */
  readonly fingerprintsFound: ReadonlyMap<string, readonly string[]>;
  /** The key text a module built for a timer from a personal value. */
  readonly jobKey: string;
  /** The key text a module chose for an external effect from a personal value. */
  readonly effectKey: string;
  /** The part a reaction declared its key from. */
  readonly topic: string;
  readonly envelopes: readonly FoundEnvelope[];
}

/**
 * The personal values in derived data are gone. No plain fingerprint of a command whose input held
 * a value of the subject is in the dump: the receipt of a command another principal ran is
 * scrubbed, and no command writes a plain fingerprint at all: a receipt holds the keyed `kwf1.`
 * form and a decision record the decision base, which holds no personal value. Bea's commands hold
 * none of Ada's values and may keep theirs. The key a module built from a personal value is stored
 * as a digest, never as the text (a timer's, and the key of an external effect in its record and
 * its requested event), a reaction's key is no longer the unsalted hash of its part, and a sealed
 * value hides its length in buckets of 32 bytes.
 */
function expectDerivedDataGone(evidence: DerivedDataEvidence): void {
  const { after, planted, erasedMarkers } = evidence;
  const heldAfter = [...evidence.fingerprints]
    .filter(([name]) => {
      const text = JSON.stringify(planted.get(name)?.input ?? null);
      return erasedMarkers.some((value) => text.includes(value));
    })
    .filter(([, hash]) => after.includes(hash))
    .map(([name]) => name);
  expect(heldAfter, 'a plain fingerprint of a command that held a value of the subject').toEqual(
    [],
  );
  expect(
    [...evidence.fingerprintsFound.keys()].filter((name) => !name.includes('bea')),
    'no command that touched the subject keeps its plain fingerprint, whoever ran it',
  ).toEqual([]);
  expect(after, 'the key text of the timer is not in the dump').not.toContain(evidence.jobKey);
  expect(after, 'the key text of the external effect is not in the dump').not.toContain(
    evidence.effectKey,
  );
  expect(after, 'the plain hash of the reaction key part is not in the dump').not.toContain(
    createHash('sha256').update(evidence.topic).digest('hex'),
  );
  for (const envelope of evidence.envelopes.filter((one) => one.kind === 'kwe')) {
    expect(
      (envelope.sealed.length - 16) % 32,
      `a $kwe ciphertext of ${envelope.table} is a multiple of 32 bytes`,
    ).toBe(0);
  }
}

export type { DerivedDataEvidence };
export { expectDerivedDataGone };
