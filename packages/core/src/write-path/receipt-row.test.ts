import { expect, test } from 'vitest';
import { user } from '../../test/invoker/invoker-kit.ts';
import { inputFingerprint } from './input-fingerprint.ts';
import { receiptRow } from './receipt-row.ts';

const now = Temporal.Instant.from('2026-11-04T10:00:00Z');

test('the pending receipt row is the golden F-12 shape', () => {
  const row = receiptRow({
    commandId: 'cmd-1',
    action: 'library.addBook',
    fingerprint: 'f'.repeat(64),
    principal: user('ada'),
    apiVersion: '2026-11-04',
    request: {
      transport: 'rest',
      requestId: 'req-1',
      userAgent: 'probe/1',
      connection: {
        id: 'c1',
        listener: 'http',
        remote: { address: '203.0.113.7', port: 5000 },
        local: { address: '10.0.0.1', port: 8080 },
      },
    },
    client: { id: 'client-1', seq: 4 },
    now,
  });
  expect({ ...row, expiresAt: row.expiresAt.toString() }).toEqual({
    commandId: 'cmd-1',
    action: 'library.addBook',
    fingerprint: 'f'.repeat(64),
    principal: user('ada').ref,
    principalResolver: null,
    principalId: null,
    status: 'pending',
    outcome: null,
    apiVersion: '2026-11-04',
    request: { transport: 'rest', remoteAddress: '203.0.113.7', userAgent: 'probe/1' },
    clientId: 'client-1',
    clientSeq: 4,
    expiresAt: '2026-11-05T10:00:00Z',
  });
});

test('a request without a connection, agent or client leaves those members null', () => {
  const row = receiptRow({
    commandId: 'cmd-2',
    action: 'library.addBook',
    fingerprint: 'a'.repeat(64),
    principal: user('ada'),
    apiVersion: '2026-11-04',
    request: { transport: 'test', requestId: 'req-2' },
    now,
  });
  expect(row.request).toEqual({ transport: 'test', remoteAddress: null, userAgent: null });
  expect([row.clientId, row.clientSeq]).toEqual([null, null]);
});

test('the flat principal id is copied from the reference and null without one', () => {
  const base = {
    commandId: 'cmd-3',
    action: 'library.addBook',
    fingerprint: 'b'.repeat(64),
    apiVersion: '2026-11-04',
    request: { transport: 'test', requestId: 'req-3' },
    now,
  };
  const ref = { resolver: 'auth.session', principalId: 'u-7' };
  const withRef = receiptRow({ ...base, principal: { ...user('ada'), ref } });
  expect([withRef.principal, withRef.principalResolver, withRef.principalId]).toEqual([
    ref,
    'auth.session',
    'u-7',
  ]);
  const without = receiptRow({ ...base, principal: user('ada') });
  expect([without.principalResolver, without.principalId]).toEqual([null, null]);
});

test('the input fingerprint is the golden digest: a change turns every replay into a mismatch', () => {
  expect(inputFingerprint('library.addBook', '2026-11-04', { title: 'Dune', isbn: 'isbn-1' })).toBe(
    'ef7dde7516e6e408c0821b3ae495c192443bf8e6655677263a9bb53108e40020',
  );
  expect(inputFingerprint('library.addBook', '2026-11-04', { isbn: 'isbn-1', title: 'Dune' })).toBe(
    inputFingerprint('library.addBook', '2026-11-04', { title: 'Dune', isbn: 'isbn-1' }),
  );
});
