import type { DecisionRecord, EventMeta } from '@keelwerk/core';
import { expect, test } from 'vitest';
import { decodeEventMeta } from '../src/sql/decode-event-meta.ts';
import { encodeEventMeta } from '../src/sql/encode-event-meta.ts';
import { newEvent } from './support/new-event.ts';

function metaOf(request: DecisionRecord['request']): EventMeta {
  return {
    ...newEvent(1).meta,
    commandId: '0192a3b4-c5d6-7000-8000-0000000000aa',
    action: 'auth.login',
    decision: {
      part: 'auth.login',
      inputDigest: 'kwb1.abc',
      reads: [{ at: 7n }],
      answers: [],
      effects: [],
      ...(request === undefined ? {} : { request }),
    },
  };
}

test('a request sealed under a value key of its own survives the JSON text of the column', () => {
  const meta = metaOf({
    keyId: 'vk_1',
    nonce: new Uint8Array(12).fill(7),
    ciphertext: Uint8Array.from([1, 2, 3, 4]),
  });
  expect(decodeEventMeta(encodeEventMeta(meta))).toEqual(meta);
});

test('a request that is a $kwe envelope survives the JSON text of the column unchanged', () => {
  const meta = metaOf({ $kwe: 2, k: 'dk_1', n: 'AAAAAAAAAAAAAAAA', c: 'AQIDBA' });
  const stored = encodeEventMeta(meta);
  expect(JSON.parse(stored).decision.request).toEqual({
    $kwe: 2,
    k: 'dk_1',
    n: 'AAAAAAAAAAAAAAAA',
    c: 'AQIDBA',
  });
  expect(decodeEventMeta(stored)).toEqual(meta);
});

test('a decision record without a request has none after the round trip', () => {
  const meta = metaOf(undefined);
  expect('request' in (decodeEventMeta(encodeEventMeta(meta)).decision ?? {})).toBe(false);
});
