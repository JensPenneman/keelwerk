import { expect } from 'vitest';
import type { DumpQuery } from '../../../src/index.ts';
import { rowsOf, spellingsOf } from './erasure-dump-tools.ts';
import { type FoundEnvelope, openWithoutTag } from './erasure-envelopes.ts';
import { formsFoundIn } from './erasure-forms.ts';
import type { KeyLeft } from './erasure-keys-left.ts';

interface SealedSubject {
  readonly $kwe?: 1 | 2;
  readonly k?: string;
  readonly n?: string;
  readonly c?: string;
}

/** The dead jobs of the probe process that refuses every thread: jobs of the module's service principal. */
const deadSubjectJobs = async (
  queries: readonly DumpQuery[],
): Promise<readonly Record<string, unknown>[]> =>
  (await rowsOf(queries, 'kw_jobs')).filter(
    (row) => row.state === 'dead' && String(row.dead_letter).includes('doomed'),
  );

/** The instance key a process job stores, sealed under the data key of its subject. */
function sealedSubjectOf(row: Record<string, unknown>): FoundEnvelope | undefined {
  const run = (typeof row.input === 'string' ? JSON.parse(row.input) : row.input) as {
    readonly input?: { readonly subject?: SealedSubject | null };
  };
  const sealed = run.input?.subject;
  if (sealed?.k === undefined || sealed.n === undefined || sealed.c === undefined) return undefined;
  return {
    table: 'kw_jobs',
    kind: 'kwe',
    ...(sealed.$kwe === undefined ? {} : { version: sealed.$kwe }),
    keyId: sealed.k,
    nonce: Buffer.from(sealed.n, 'base64url'),
    sealed: Buffer.from(sealed.c, 'base64url'),
  };
}

/** The dead jobs that hold an envelope sealed under the key `keyId`. */
async function deadJobsUnder(
  queries: readonly DumpQuery[],
  keyId: string,
): Promise<readonly FoundEnvelope[]> {
  return (await deadSubjectJobs(queries))
    .map(sealedSubjectOf)
    .filter((envelope): envelope is FoundEnvelope => envelope?.keyId === keyId);
}

/**
 * Before the erasure: a dead job of another principal holds the instance key (the subject's id)
 * sealed under the subject's data key, and that key opens it to the subject's id.
 */
async function expectDeadJobOpens(
  queries: readonly DumpQuery[],
  key: { readonly id: string; readonly material: Uint8Array },
  subject: string,
): Promise<number> {
  const envelopes = await deadJobsUnder(queries, key.id);
  expect(envelopes.length, 'a dead job holds an envelope under the subject key').toBeGreaterThan(0);
  for (const envelope of envelopes) {
    expect(openWithoutTag(envelope, key.material)?.toString('utf8')).toBe(subject);
  }
  return (await deadSubjectJobs(queries)).length;
}

/**
 * After the erasure: the dead jobs of the other principal are all still there (an erasure purges
 * only the jobs whose principal is the subject), the envelope under the destroyed key opens with no
 * key that is left, and neither the input nor the dead letter of any of them holds a marker or
 * a spelling of the subject's id.
 */
async function expectDeadJobUnreadable(input: {
  readonly queries: readonly DumpQuery[];
  readonly keyId: string;
  readonly keys: readonly KeyLeft[];
  readonly subject: string;
  readonly markers: readonly string[];
  readonly kept: number;
}): Promise<void> {
  const { queries, keyId, keys, subject, markers, kept } = input;
  const dead = await deadSubjectJobs(queries);
  expect(dead.length, "another principal's dead job is kept (D7)").toBe(kept);
  const left = dead.map(sealedSubjectOf).filter((envelope) => envelope !== undefined);
  expect(left.length, 'its sealed subject is still stored').toBeGreaterThan(0);
  expect(
    left.filter((envelope) => envelope.keyId === keyId),
    'the envelopes under the destroyed key stay as they were',
  ).not.toEqual([]);
  for (const envelope of left.filter((entry) => entry.keyId === keyId)) {
    for (const key of keys) {
      const opened = openWithoutTag(envelope, key.material)?.toString('utf8') ?? '';
      expect(opened, `${key.label} does not open the sealed subject`).not.toBe(subject);
    }
  }
  const text = JSON.stringify(dead.map((row) => [row.input, row.dead_letter]));
  expect(formsFoundIn(text, [...markers, ...spellingsOf(subject)])).toEqual([]);
}

export { expectDeadJobOpens, expectDeadJobUnreadable };
