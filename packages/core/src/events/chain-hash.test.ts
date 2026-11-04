import canonicalize from 'canonicalize';
import { expect, test } from 'vitest';
import { sha256 } from '../crypto/sha256.ts';
import { buildDecisionRecord } from './build-decision-record.ts';
import { buildIdentity } from './build-identity.ts';
import { type ChainFields, chainContent } from './chain-content.ts';
import { chainHash } from './chain-hash.ts';

const created: ChainFields = {
  eventId: '0192a3b4-c5d6-7000-8000-000000000001',
  streamId: '0192a3b4-c5d6-7000-8000-0000000000aa',
  version: 1,
  name: 'created',
  schemaVersion: 1,
  data: { values: { title: 'Dune', isbn: 'isbn-1' } },
  before: null,
  hlc: '0192a3b4c5d60000-s0000000000',
  recordedAt: Temporal.Instant.from('2026-11-04T10:00:00.123456789Z'),
  actor: { kind: 'user', id: 'ada', via: 'session' },
  writer: { build: 'b'.repeat(64), revision: 1 },
  flags: [{ key: 'beta', variant: 'off', reason: 'DEFAULT', ruleVersion: null }],
  decision: buildDecisionRecord({
    part: 'library.addBook',
    inputDigest: 'd'.repeat(64),
    reads: [{ at: 7n }, { scope: 'backend', at: 18446744073709551615n }],
    answers: [
      { kind: 'id', entity: 'library.book', value: '0192a3b4-c5d6-7000-8000-0000000000aa' },
    ],
    effects: ['0192a3b4-c5d6-7000-8000-0000000000ee'],
  }),
  commandId: 'c1',
  client: null,
};

const changed: ChainFields = {
  ...created,
  version: 2,
  name: 'changed',
  data: { set: { title: 'Dune Messiah' } },
  before: { title: 'Dune' },
};

// Golden vectors: the chain is a stored format, final from M1. They were produced with the
// independent `canonicalize` package and node:crypto, not with the kernel's own canonicaliser.
const goldenText =
  '{"actor":{"id":"ada","kind":"user","via":"session"},"before":null,"client":null,"commandId":"c1","data":{"values":{"isbn":"isbn-1","title":"Dune"}},"decision":{"answers":[{"entity":"library.book","kind":"id","value":"0192a3b4-c5d6-7000-8000-0000000000aa"}],"effects":["0192a3b4-c5d6-7000-8000-0000000000ee"],"inputDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","part":"library.addBook","reads":[{"at":"7"},{"at":"18446744073709551615","scope":"backend"}]},"eventId":"0192a3b4-c5d6-7000-8000-000000000001","flags":[{"key":"beta","reason":"DEFAULT","ruleVersion":null,"variant":"off"}],"hlc":"0192a3b4c5d60000-s0000000000","name":"created","recordedAt":"2026-11-04T10:00:00.123Z","schemaVersion":1,"streamId":"0192a3b4-c5d6-7000-8000-0000000000aa","version":1,"writer":{"build":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","revision":1}}';
const goldenFirst = '0bfd6e4b87da3058f645c5805ce71f6c7c51aa6ce593bca58b44eb285777fcb5';
const goldenSecond = '725597accf74ca771984b197593d0476614cc85eff9b5df00ee6660c2d2feaa5';

test('the content of the first event is the RFC 8785 text of the golden vector', () => {
  expect(canonicalize(chainContent(created))).toBe(goldenText);
});

test('the first hash is SHA-256 of the content text, the second of the first hash and its content', () => {
  expect(chainHash(null, created)).toBe(goldenFirst);
  expect(chainHash(goldenFirst, changed)).toBe(goldenSecond);
});

test('the hash follows the independent implementation: previous hash text, then the content', () => {
  expect(chainHash(goldenFirst, changed)).toBe(
    sha256(`${goldenFirst}${canonicalize(chainContent(changed))}`),
  );
});

test('every member of the chain content moves the hash, writer, flags and decision included (S-60)', () => {
  const base = chainHash(null, created);
  const variants: readonly ChainFields[] = [
    { ...created, eventId: '0192a3b4-c5d6-7000-8000-000000000002' },
    { ...created, streamId: 'other' },
    { ...created, version: 2 },
    { ...created, name: 'archived' },
    { ...created, schemaVersion: 2 },
    { ...created, data: { values: { title: 'Dune', isbn: 'isbn-2' } } },
    { ...created, before: { title: 'x' } },
    { ...created, hlc: '0192a3b4c5d60001-s0000000000' },
    { ...created, recordedAt: Temporal.Instant.from('2026-11-04T10:00:00.124Z') },
    { ...created, actor: { ...created.actor, id: 'bob' } },
    { ...created, writer: { ...created.writer, revision: 2 } },
    { ...created, writer: { ...created.writer, build: 'c'.repeat(64) } },
    { ...created, flags: [] },
    { ...created, decision: null },
    { ...created, decision: { ...(created.decision as object), effects: [] } as never },
    { ...created, commandId: 'c2' },
    { ...created, client: { id: 'phone', seq: 1 } },
  ];
  for (const variant of variants) expect(chainHash(null, variant)).not.toBe(base);
  expect(chainHash(goldenFirst, created)).not.toBe(base);
});

test('the recorded time is hashed at millisecond precision, the precision adapters store', () => {
  const finer = { ...created, recordedAt: Temporal.Instant.from('2026-11-04T10:00:00.123999Z') };
  expect(chainHash(null, finer)).toBe(goldenFirst);
});

test('a recorded time ending in zeros keeps three fractional digits, as toISOString writes it', () => {
  const zero = { ...created, recordedAt: Temporal.Instant.from('2026-11-04T10:00:00.120Z') };
  const whole = { ...created, recordedAt: Temporal.Instant.from('2026-11-04T10:00:00Z') };
  expect(chainContent(zero).recordedAt).toBe('2026-11-04T10:00:00.120Z');
  expect(chainContent(whole).recordedAt).toBe('2026-11-04T10:00:00.000Z');
  expect(chainHash(null, zero)).toBe(
    '30f8312eb3c87e4d50b76fabe9b1d110b252211e4e294c03044dc9e6ca854cbc',
  );
  expect(chainHash(null, whole)).toBe(
    '0999a1c0cda2aed73828d78533ed62b530ca290d7a37055bab0e575b910800a1',
  );
  const text = canonicalize(chainContent(zero));
  expect(text).toContain('"recordedAt":"2026-11-04T10:00:00.120Z"');
  expect(chainHash(null, zero)).toBe(sha256(text as string));
});

test('the build id is the SHA-256 of the canonical manifest and the revision starts at 1 (S-22)', () => {
  const manifest = {
    packages: { '@keelwerk/data': '0.0.0', '@keelwerk/core': '0.0.0' },
    migrations: { core: 'abc' },
    apiVersions: { portal: ['v2', 'v1'], admin: ['v1'] },
  };
  expect(buildIdentity(manifest)).toEqual({
    id: 'cca3805f3b1d327e41ca195302618c5a9b2b859c0287df54e1e7df0452edf0a0',
    revision: 1,
  });
  expect(
    buildIdentity({ ...manifest, apiVersions: { admin: ['v1'], portal: ['v1', 'v2'] } }).id,
  ).toBe(buildIdentity(manifest).id);
  expect(
    buildIdentity({ ...manifest, apiVersions: { portal: ['v2', 'v1'], admin: ['v2'] } }).id,
  ).not.toBe(buildIdentity(manifest).id);
  expect(buildIdentity({ ...manifest, migrations: { core: 'abd' } }).id).not.toBe(
    buildIdentity(manifest).id,
  );
});

test('a decision record copies its lists and leaves absent members out', () => {
  const reads = [{ at: 1n }];
  const record = buildDecisionRecord({
    part: 'a.b',
    inputDigest: 'x',
    reads,
    answers: [],
    effects: [],
  });
  reads.push({ at: 2n });
  expect(record.reads).toEqual([{ at: 1n }]);
  expect('input' in record).toBe(false);
});
