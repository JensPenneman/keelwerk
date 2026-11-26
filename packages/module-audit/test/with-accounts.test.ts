import { describe, expect, onTestFinished, test } from 'vitest';
import {
  type AuditStorage,
  type BootedAudit,
  bootAudit,
  withAccountsApp,
} from './support/boot-audit.ts';
import { holdReactionJobs } from './support/hold-reaction-jobs.ts';

const person = { identifier: 'ada@example.org', password: 'correct horse battery staple' };

describe.each(['memory', 'pglite'] as const)(
  'audit with accounts and auth on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedAudit<typeof withAccountsApp>> {
      const app = await bootAudit(withAccountsApp, kind);
      onTestFinished(() => app.runtime.stop());
      return app;
    }

    test('a sign-up, a login and a profile change leave entries with their request metadata', {
      timeout,
    }, async () => {
      const app = await boot();
      const signedUp = await app.request('auth.signUp', { ...person, displayName: 'Ada' });
      if (!signedUp.ok) throw signedUp.error;
      const login = await app.request('auth.login', person);
      if (!login.ok) throw login.error;
      const { sessionToken } = login.value as { sessionToken: string };
      const headers = { authorization: `Bearer ${sessionToken}`, 'user-agent': 'AuditAgent/1.0' };
      const who = await app.request('auth.whoami', {}, { headers });
      if (!who.ok) throw who.error;
      const subject = (who.value as { subject: string }).subject;
      const edited = await app.request(
        'accounts.profile.update',
        { id: subject, patch: { displayName: 'Ada L.' } },
        { headers },
      );
      expect(edited.ok).toBe(true);
      await app.settle();

      const entries = await app.entries();
      const of = (type: string) => entries.filter((entry) => entry.eventType === type);
      const [loggedIn] = of('auth.credential.loggedIn');
      // The login is anonymous: its subject is the credential's, and its request metadata is kept.
      expect(loggedIn).toMatchObject({
        actorKind: 'anonymous',
        action: 'auth.login',
        subject,
        transport: 'test',
      });
      expect(String(loggedIn?.remoteAddress)).toMatch(/^198\.1[89]\./);
      const changed = of('accounts.profile.changed').find(
        (entry) => entry.action === 'accounts.profile.update',
      );
      expect(changed).toMatchObject({
        actorKind: 'user',
        action: 'accounts.profile.update',
        subject,
        transport: 'test',
        userAgent: 'AuditAgent/1.0',
      });
      expect(String(changed?.remoteAddress)).toMatch(/^198\.1[89]\./);
      expect(of('auth.credential.created').length).toBeGreaterThan(0);
      // One entry per event: no event id twice.
      expect(new Set(entries.map((entry) => entry.eventId)).size).toBe(entries.length);
    });

    test('a profile change whose job runs after the erasure of the person leaves no entry of theirs', {
      timeout,
    }, async () => {
      const app = await boot();
      const signedUp = await app.request('auth.signUp', { ...person, displayName: 'Ada' });
      if (!signedUp.ok) throw signedUp.error;
      const login = await app.request('auth.login', person);
      if (!login.ok) throw login.error;
      const { sessionToken } = login.value as { sessionToken: string };
      const headers = { authorization: `Bearer ${sessionToken}` };
      const who = await app.request('auth.whoami', {}, { headers });
      if (!who.ok) throw who.error;
      const subject = (who.value as { subject: string }).subject;
      await app.settle();
      const jobs = holdReactionJobs(app.runtime.adapter);
      const edited = await app.request(
        'accounts.profile.update',
        { id: subject, patch: { displayName: 'Ada L.' } },
        { headers },
      );
      expect(edited.ok).toBe(true);
      await app.erase(subject);
      jobs.release();
      await app.settle();
      const entries = await app.entries();
      expect(entries.filter((entry) => entry.subject === subject)).toEqual([]);
    });

    test('the jobs of a sign-up and a login that run after the erasure of the person leave no entry and no dead letter', {
      timeout,
    }, async () => {
      const app = await boot();
      const jobs = holdReactionJobs(app.runtime.adapter);
      const signedUp = await app.request('auth.signUp', { ...person, displayName: 'Ada' });
      if (!signedUp.ok) throw signedUp.error;
      const login = await app.request('auth.login', person);
      if (!login.ok) throw login.error;
      const { sessionToken } = login.value as { sessionToken: string };
      const who = await app.request(
        'auth.whoami',
        {},
        { headers: { authorization: `Bearer ${sessionToken}` } },
      );
      if (!who.ok) throw who.error;
      const subject = (who.value as { subject: string }).subject;
      await app.settle();
      expect(await app.entries()).toEqual([]);
      await app.erase(subject);
      jobs.release();
      await app.settle();
      // The events of the sign-up and the login name an anonymous actor: the person is known only by
      // the row of the credential, which the erasure tombstoned. The kernel's own events of the
      // erasure and of the profile link are another actor's and stay.
      const entries = await app.entries();
      expect(entries.filter((entry) => entry.actorKind === 'anonymous')).toEqual([]);
      expect(
        entries.filter((entry) => ['auth.signUp', 'auth.login'].includes(String(entry.action))),
      ).toEqual([]);
      expect(entries.filter((entry) => entry.subject === subject)).toEqual([]);
      expect(jobs.outcomes.length).toBeGreaterThan(0);
      expect(
        jobs.outcomes.map((outcome) => outcome.kind).filter((kind) => kind !== 'succeeded'),
      ).toEqual([]);
    });

    test("a tenant's entries are invisible in another tenant", { timeout }, async () => {
      const app = await boot();
      const signedUp = await app.request('auth.signUp', person);
      expect(signedUp.ok).toBe(true);
      await app.settle();
      expect((await app.entries('acme')).length).toBeGreaterThan(0);
      expect(await app.entries('globex')).toEqual([]);
      const acmeIds = (await app.entries('acme')).map((entry) => entry.eventId);
      const globex = await app.operator('globex').invoke('audit.entry.query', {});
      expect(globex.items).toEqual([]);
      const acme = await app.operator('acme').invoke('audit.entry.query', {});
      expect(acme.items.map((item: { eventId: string }) => item.eventId).sort()).toEqual(
        acmeIds.sort(),
      );
    });
  },
);
