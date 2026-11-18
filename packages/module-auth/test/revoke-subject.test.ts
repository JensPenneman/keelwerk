import type { Unit } from '@keelwerk/core';
import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, signIn } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { bootBoth } from './support/boot-both.ts';
import { holdJobs } from './support/hold-jobs.ts';

const operator = testOperator();

describe.each(['memory', 'pglite'] as const)('revokeSubject on %s', (kind: StorageKind) => {
  test('a deactivation revokes more live sessions and credentials than one page holds', {
    timeout: kind === 'pglite' ? 120_000 : 30_000,
  }, async () => {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const signed = await both.request('auth.signUp', ada);
    if (!signed.ok) throw signed.error;
    await signIn(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const descriptorOf = (name: string) => {
      const descriptor = both.runtime.app.registry.entities.get(name)?.descriptor;
      if (descriptor === undefined) throw new Error(`no ${name}`);
      return descriptor;
    };
    // The rows are copied from the real ones, so they carry the subject and the sealed members as stored.
    await both.inUnit(
      async (unit) => {
        const sessions = descriptorOf('auth.session');
        const credentials = descriptorOf('auth.credential');
        const session = (await unit.rows.find(sessions, { select: Object.keys(sessions.fields) }))
          .rows[0];
        const credential = (
          await unit.rows.find(credentials, { select: Object.keys(credentials.fields) })
        ).rows[0];
        if (session === undefined || credential === undefined) throw new Error('nothing to copy');
        await unit.rows.insert(
          sessions,
          Array.from({ length: 1004 }, () => ({
            ...session,
            id: crypto.randomUUID(),
            publicId: crypto.randomUUID(),
            version: 0,
          })),
        );
        await unit.rows.insert(credentials, [
          { ...credential, id: crypto.randomUUID(), identifier: 'second@example.org', version: 0 },
        ]);
      },
      { sealed: true },
    );
    const live = async () => ({
      sessions: (await both.rows('auth.session')).filter((row) => row.revokedAt === undefined)
        .length,
      credentials: (await both.rows('auth.credential')).filter((row) => row.revokedAt === undefined)
        .length,
    });
    expect(await live()).toEqual({ sessions: 1005, credentials: 2 });
    const done = await both
      .client(operator)
      .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
    expect(done.ok ? undefined : done.error).toBeUndefined();
    // The credentials go in the deactivating unit; the sessions follow, a page at a time, in jobs.
    expect((await live()).credentials).toBe(0);
    await both.settle();
    expect(await live()).toEqual({ sessions: 0, credentials: 0 });
  });

  test('the deactivating unit reads and writes no session row, so a session in use cannot fail it', {
    timeout: kind === 'pglite' ? 120_000 : 30_000,
  }, async () => {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const signed = await both.request('auth.signUp', ada);
    if (!signed.ok) throw signed.error;
    const session = await signIn(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const held = holdJobs(both.runtime.adapter);
    // Every row the units of the deactivation touch, by entity: a session row among them would be
    // one that a request using the session (its extension) can change before the unit commits.
    const touched = new Set<string>();
    const watched = (unit: Unit): Unit => ({
      ...unit,
      rows: Object.fromEntries(
        Object.entries(unit.rows).map(([name, method]) => [
          name,
          (entity: { ref: string }, ...rest: unknown[]) => {
            touched.add(`${name} ${entity.ref}`);
            return (method as (...args: unknown[]) => unknown).call(unit.rows, entity, ...rest);
          },
        ]),
      ) as unknown as typeof unit.rows,
      nested: (fn, nestedOptions) => unit.nested((inner) => fn(watched(inner)), nestedOptions),
    });
    const target = both.runtime.adapter as { unit: typeof both.runtime.adapter.unit };
    const inner = target.unit.bind(both.runtime.adapter);
    target.unit = (namespace, scope, fn, options) =>
      inner(namespace, scope, (unit) => fn(watched(unit)), options);
    const done = await both
      .client(operator)
      .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
    expect(done.ok ? undefined : done.error).toBeUndefined();
    expect([...touched].some((call) => call.endsWith(' auth.credential'))).toBe(true);
    expect([...touched].filter((call) => call.endsWith(' auth.session'))).toEqual([]);
    // The session is dead at once, though its row is still to be revoked.
    const rows = await both.rows('auth.session');
    expect(rows.every((row) => row.revokedAt === undefined)).toBe(true);
    const whoami = await both.request(
      'auth.whoami',
      {},
      { headers: { authorization: `Bearer ${session.sessionToken}` } },
    );
    expect(whoami.ok).toBe(false);
    // The follow-up job revokes the rows when it runs.
    held.release();
    await both.settle();
    expect((await both.rows('auth.session')).every((row) => row.revokedAt !== undefined)).toBe(
      true,
    );
  });
});
