import type { PrincipalRef, PrincipalResolver, Scope } from '@keelwerk/core';
import { describe, expect, onTestFinished, test } from 'vitest';
import { principalResolversFill } from '../src/contributions/to-core/fills/principal-resolvers.ts';
import { createKey, keyOwner, keyOwnerSubject } from './support/api-key-calls.ts';
import { bootApiKeys, bootedAt, type KeysStorage } from './support/boot-api-keys.ts';
import { failedAttempts, jobsOfKey, watchStore } from './support/watch-store.ts';

const tenant: Scope = { level: 'tenant', backendId: 'b1', tenantId: 't1' };
const clock = { now: () => bootedAt };
const keyId = '01a1cfed-8108-7458-8247-5e53af69a80f';
const ref: PrincipalRef = { resolver: 'api-keys.key', principalId: keyId };

/** The resolver over a row, as the kernel drives `fromRef` for a redeemed stream ticket or a job. */
function standing(scopes: readonly string[], transport: string | null) {
  const row = { id: keyId, subject: keyOwnerSubject, scopes, publicId: 'a'.repeat(26) };
  const own = {
    load: {
      apiKeys: {
        key: {
          // biome-ignore lint/correctness/useYield: the stub answers at once
          *byId() {
            return row;
          },
        },
      },
    },
  };
  const [resolver] = (
    principalResolversFill.factory as unknown as (own: never) => PrincipalResolver[]
  )(own as never);
  const step = resolver?.fromRef?.(ref, { scope: tenant, clock, transport }).next();
  return step?.done === true ? step.value : undefined;
}

describe('a key that names transports is redeemed only on them', () => {
  test('a ticket redeemed on a transport the key does not name does not resolve', () => {
    expect(standing(['write', 'transport:cli'], 'http')).toBeNull();
    expect(standing(['write', 'transport:cli'], 'cli')?.principal).toMatchObject({ kind: 'user' });
  });

  test('a key that names transports is refused where the transport is unknown', () => {
    expect(standing(['write', 'transport:cli'], null)).toBeNull();
  });

  test('a key that names none is redeemed on any transport, and where it is unknown', () => {
    expect(standing(['write'], 'http')?.principal).toMatchObject({ kind: 'user' });
    expect(standing(['write'], null)?.principal).toMatchObject({ kind: 'user' });
  });
});

describe.each(['memory', 'pglite'] as const)('a bound key on %s', (kind: KeysStorage) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  test("an async command a cli-bound key queued on cli runs: the job carries the receipt's transport", {
    timeout,
  }, async () => {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    const watch = watchStore(app.runtime.adapter);
    const { key, id } = await createKey(app, { scopes: ['write', 'transport:cli'] });
    const queued = await app.withKey(
      key,
      'loans.lend',
      { bookTitle: 'Ulysses', dueAt: Temporal.Instant.from('2027-01-01T00:00:00Z') },
      { transport: 'cli', prefer: 'async' },
    );
    expect(queued.ok).toBe(true);
    await app.runtime.drainJobs();
    expect(jobsOfKey(watch, id)).toHaveLength(1);
    expect(failedAttempts(watch)).toEqual([]);
    expect(watch.outcomes.map((outcome) => outcome.kind)).toContain('succeeded');
  });

  test('work a cli-bound key queued through an enqueue effect fails unauthenticated', {
    timeout,
  }, async () => {
    const app = await bootApiKeys(kind);
    onTestFinished(() => app.runtime.stop());
    const watch = watchStore(app.runtime.adapter);
    const { key, id } = await createKey(app, { scopes: ['write', 'transport:cli'] });
    const at = bootedAt.add({ hours: 1 });
    const queued = await app.withKey(
      key,
      'later.addBookAt',
      { at, title: 'bound', isbn: 'bound' },
      { transport: 'cli' },
    );
    expect(queued.ok).toBe(true);
    await app.runtime.advanceTo(at);
    const [job] = jobsOfKey(watch, id);
    expect(failedAttempts(watch)).toEqual([
      { jobId: job, outcome: 'failed:core.unauthenticated:unauthenticated' },
    ]);
    const books = await app.as(keyOwner).invoke('library.book.query', {});
    expect(books.items).toEqual([]);
  });
});
