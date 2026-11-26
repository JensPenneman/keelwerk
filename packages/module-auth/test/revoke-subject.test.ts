import type { Unit } from '@keelwerk/core';
import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, asCookie, signIn } from './support/auth-calls.ts';
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
    // The credentials and the sessions are revoked by jobs, a page at a time.
    await both.settle();
    expect(await live()).toEqual({ sessions: 0, credentials: 0 });
  });

  test('the deactivating unit writes no credential and no session row, so neither in use can fail it', {
    timeout: kind === 'pglite' ? 120_000 : 30_000,
  }, async () => {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const signed = await both.request('auth.signUp', ada);
    if (!signed.ok) throw signed.error;
    const session = await signIn(both);
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const held = holdJobs(both.runtime.adapter);
    // Every row write the units of the deactivation make, by entity: a credential or session row
    // among them would be one that a login or a request using the session can change before the unit commits.
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
    expect(touched.has('update accounts.profile')).toBe(true);
    expect([...touched].filter((call) => /^(insert|update|purge) auth\./.test(call))).toEqual([]);
    // The session is dead at once, though its row is still to be revoked.
    for (const entity of ['auth.session', 'auth.credential']) {
      expect((await both.rows(entity)).every((row) => row.revokedAt === undefined)).toBe(true);
    }
    const whoami = await both.request(
      'auth.whoami',
      {},
      { headers: { authorization: `Bearer ${session.sessionToken}` } },
    );
    // The kernel's own text, which names no reason; the same credential on a cookie is refused alike.
    expect(whoami.ok ? undefined : whoami.error).toMatchObject({
      kind: 'unauthenticated',
      message: 'The credentials were not accepted.',
    });
    const cookie = await both.request(
      'auth.whoami',
      {},
      { headers: asCookie(session.sessionToken) },
    );
    expect(cookie.ok ? undefined : cookie.error.kind).toBe('unauthenticated');
    // The follow-up job revokes the rows when it runs.
    held.release();
    await both.settle();
    for (const entity of ['auth.session', 'auth.credential']) {
      expect((await both.rows(entity)).every((row) => row.revokedAt !== undefined)).toBe(true);
    }
    const afterJob = await both.request(
      'auth.whoami',
      {},
      { headers: asCookie(session.sessionToken) },
    );
    expect(afterJob.ok ? undefined : afterJob.error.kind).toBe('unauthenticated');
  });

  test('a login between the deactivation and its revocation job opens a session that never resolves, and the credential is revoked once the job has run', {
    timeout: kind === 'pglite' ? 120_000 : 30_000,
  }, async () => {
    const both = await bootBoth(kind);
    onTestFinished(() => both.runtime.stop());
    const signed = await both.request('auth.signUp', ada);
    if (!signed.ok) throw signed.error;
    const profileId = String((await both.rows('accounts.profile'))[0]?.id);
    const held = holdJobs(both.runtime.adapter);
    const done = await both
      .client(operator)
      .attempt('accounts.profile.deactivate', { id: profileId as never, reason: 'left' });
    expect(done.ok ? undefined : done.error).toBeUndefined();
    // The credential is not revoked yet, so the login is accepted.
    const late = await both.request('auth.login', ada);
    expect(late.ok).toBe(true);
    const { sessionToken } = (late.ok ? late.value : {}) as { sessionToken: string };
    const whoami = await both.request(
      'auth.whoami',
      {},
      { headers: { authorization: `Bearer ${sessionToken}` } },
    );
    expect(whoami.ok ? undefined : whoami.error.kind).toBe('unauthenticated');
    held.release();
    await both.settle();
    expect((await both.rows('auth.credential')).every((row) => row.revokedAt !== undefined)).toBe(
      true,
    );
    expect((await both.rows('auth.session')).every((row) => row.revokedAt !== undefined)).toBe(
      true,
    );
    const again = await both.request('auth.login', ada);
    expect(again.ok).toBe(false);
  });
});
