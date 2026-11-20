import type { DecisionRecord, NewEvent } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { id } from './support/id.ts';
import { newEvent } from './support/new-event.ts';
import { storeSuite } from './support/store-suite.ts';
import { tenantScope } from './support/tenant-scope.ts';

const store = storeSuite();

describe('reading a decision record with a request member', () => {
  test('a decision record with request comes back with its nonce and ciphertext as bytes', async () => {
    const decision: DecisionRecord = {
      part: 'auth.login',
      inputDigest: 'digest',
      reads: [{ at: 1n }],
      answers: [],
      effects: [],
      request: {
        keyId: 'vk_1',
        nonce: new Uint8Array(12).fill(7),
        ciphertext: Uint8Array.from([1, 2, 3, 4]),
      },
    };
    const base = newEvent(1);
    const event: NewEvent = {
      ...base,
      prevHash: 'ab'.repeat(32),
      hash: 'cd'.repeat(32),
      meta: { ...base.meta, commandId: id(5), action: 'auth.login', decision },
    };
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        {
          stream: { type: 'app.note', id: id(1) },
          expectedVersion: 0,
          partition: null,
          events: [event],
        },
      ]),
    );
    const [stored] = (
      await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 1 }))
    ).events;
    expect(stored?.decision).toEqual(decision);
    const request = stored?.decision?.request;
    if (request === undefined || '$kwe' in request) throw new Error('expected a sealed value');
    expect(request.nonce).toBeInstanceOf(Uint8Array);
    expect(request.ciphertext).toBeInstanceOf(Uint8Array);
  });

  test('a decision record with a $kwe envelope as request comes back unchanged', async () => {
    const decision: DecisionRecord = {
      part: 'auth.login',
      inputDigest: 'digest',
      reads: [{ at: 1n }],
      answers: [],
      effects: [],
      request: { $kwe: 2, k: 'dk_1', n: 'AAAAAAAAAAAAAAAA', c: 'AQIDBA' },
    };
    const base = newEvent(1);
    const event: NewEvent = {
      ...base,
      prevHash: 'ab'.repeat(32),
      hash: 'cd'.repeat(32),
      meta: { ...base.meta, commandId: id(5), action: 'auth.login', decision },
    };
    await store.run(tenantScope, (unit) =>
      unit.events.append([
        {
          stream: { type: 'app.note', id: id(1) },
          expectedVersion: 0,
          partition: null,
          events: [event],
        },
      ]),
    );
    const [stored] = (
      await store.read(tenantScope, (unit) => unit.events.readAll(null, { limit: 1 }))
    ).events;
    expect(stored?.decision).toEqual(decision);
  });
});
