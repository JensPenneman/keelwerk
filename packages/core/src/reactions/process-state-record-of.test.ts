import { describe, expect, test } from 'vitest';
import { processStateRecordOf } from './process-state-record-of.ts';

const from = 'a'.repeat(64);
const sealed = { $kwe: 1 as const, k: 'dk-1', n: 'AQEBAQEBAQEBAQEB', c: 'Yw' };

describe('reading a stored process state record', () => {
  test('golden: a plain and a sealed record read back as written', () => {
    const plain = { v: 1 as const, from, version: 40, hash: 'abc', text: '{"count":3}' };
    expect(processStateRecordOf(JSON.parse(JSON.stringify(plain)), from)).toEqual(plain);
    const secret = { v: 1 as const, from, version: 7, hash: null, sealed };
    expect(processStateRecordOf(JSON.parse(JSON.stringify(secret)), from)).toEqual(secret);
    // A plain record may hold the text of null as its state.
    expect(processStateRecordOf({ v: 1, from, version: 1, hash: 'h', text: 'null' }, from)).toEqual(
      {
        v: 1,
        from,
        version: 1,
        hash: 'h',
        text: 'null',
      },
    );
  });

  test('members it does not know are dropped', () => {
    const read = processStateRecordOf(
      { v: 1, from, version: 2, hash: 'h', text: '1', extra: true },
      from,
    );
    expect(Object.keys(read ?? {}).sort()).toEqual(['from', 'hash', 'text', 'v', 'version']);
  });

  const good = { v: 1, from, version: 2, hash: 'h' };
  test.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', [good]],
    ['another v', { ...good, v: 2, text: '1' }],
    ['no v', { from, version: 2, hash: 'h', text: '1' }],
    ['another from', { ...good, from: 'b'.repeat(64), text: '1' }],
    ['a version of 0', { ...good, version: 0, text: '1' }],
    ['a fractional version', { ...good, version: 1.5, text: '1' }],
    ['a version that is text', { ...good, version: '2', text: '1' }],
    ['a hash that is a number', { ...good, hash: 5, text: '1' }],
    ['no hash member', { v: 1, from, version: 2, text: '1' }],
    ['neither text nor sealed', good],
    ['both text and sealed', { ...good, text: '1', sealed }],
    [
      'a state kept as a value and not as text (the form before text)',
      { ...good, state: { count: 1 } },
    ],
    ['a text that is no string', { ...good, text: { count: 1 } }],
    ['a text that is null', { ...good, text: null }],
    ['a sealed member that is text', { ...good, sealed: 'x' }],
    ['a sealed member of another form', { ...good, sealed: { $kwe: 3, k: 'a', n: 'b', c: 'c' } }],
    ['a sealed member without a nonce', { ...good, sealed: { $kwe: 1, k: 'a', c: 'c' } }],
    ['a sealed member that is null', { ...good, sealed: null }],
  ])('%s answers undefined', (_name, value) => {
    expect(processStateRecordOf(value, from)).toBeUndefined();
  });
});
