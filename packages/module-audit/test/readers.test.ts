import { testPrincipal } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import {
  type AuditStorage,
  aloneApp,
  type BootedAudit,
  bootAudit,
  forgedApp,
  membersApp,
} from './support/boot-audit.ts';
import {
  adaSubject,
  adaUser,
  foreignStaff,
  graceUser,
  wordsOfTheTest,
  wordsOnly,
} from './support/people.ts';

describe.each(['memory', 'pglite'] as const)(
  'who reads the audit trail on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(app: typeof aloneApp): Promise<BootedAudit<typeof aloneApp>> {
      const booted = await bootAudit(app, kind);
      onTestFinished(() => booted.runtime.stop());
      await booted.client(adaUser, 'acme').invoke('notes.note.create', { title: 'a' });
      await booted.client(adaUser, 'globex').invoke('notes.note.create', { title: 'g' });
      await booted.settle();
      return booted;
    }

    // The local client sends no tenant marker, so the edge rule of the operator's entry does not apply
    // here: an operator who has not entered a tenant is refused `core.tenant_not_entered` for a tenant
    // action of any module, which packages/testing/test/kernel/tenant-entry.test.ts proves
    // ("a marker without an entry is core.tenant_not_entered", on library.book.query).
    test("an operator's client scoped to the tenant and members' admin and owner read the entries", {
      timeout,
    }, async () => {
      const app = await boot(membersApp);
      await app.seat();
      for (const client of [app.operator('acme'), app.client(adaUser), app.client(graceUser)]) {
        const page = await client.invoke('audit.entry.query', {});
        const own = app.own(page.items);
        expect(own.map((item) => item.eventType)).toEqual(['notes.note.created']);
        expect(own[0]?.subject).toBe(adaSubject);
      }
      const [one] = await app.entries();
      const got = await app
        .client(adaUser)
        .invoke('audit.entry.get', { ids: [String(one?.id)] as never });
      expect(got.list).toHaveLength(1);
    });

    test('an app without the members module: the operator reads, the role admin or owner and a plain user do not', {
      timeout,
    }, async () => {
      const app = await boot(aloneApp);
      const page = await app.operator('acme').invoke('audit.entry.query', {});
      expect(page.items.map((item) => item.eventType)).toEqual(['notes.note.created']);
      for (const client of [app.client(adaUser), app.client(wordsOfTheTest)]) {
        const listed = await client.attempt('audit.entry.query', {});
        expect(listed.ok ? undefined : listed.error.kind).toBe('forbidden');
      }
    });

    test('a role admin or owner that no membership of members stands behind reads no entry', {
      timeout,
    }, async () => {
      const app = await boot(forgedApp);
      const [entry] = await app.entries();
      // The words come once from the test principal and once from another module's enricher.
      for (const client of [app.client(wordsOfTheTest), app.client(wordsOnly)]) {
        const listed = await client.attempt('audit.entry.query', {});
        expect(listed.ok ? undefined : listed.error.kind).toBe('forbidden');
        const got = await client.attempt('audit.entry.get', { ids: [String(entry?.id)] as never });
        expect(got.ok ? undefined : got.error.kind).toBe('forbidden');
      }
    });

    test("a membership of another module's kind with the role admin or owner reads no entry", {
      timeout,
    }, async () => {
      const app = await boot(forgedApp);
      const [entry] = await app.entries();
      const listed = await app.client(foreignStaff).attempt('audit.entry.query', {});
      expect(listed.ok ? undefined : listed.error.kind).toBe('forbidden');
      const got = await app
        .client(foreignStaff)
        .attempt('audit.entry.get', { ids: [String(entry?.id)] as never });
      expect(got.ok ? undefined : got.error.kind).toBe('forbidden');
    });

    test("a plain user, a members' member, an anonymous caller and globex's admin and an operator's client scoped to globex read none of acme's", {
      timeout,
    }, async () => {
      const app = await boot(membersApp);
      const [acmeEntry] = await app.entries('acme');
      const acmeId = String(acmeEntry?.id);
      const acmeEvent = String(acmeEntry?.eventId);
      const refused = [
        [app.client(graceUser), 'forbidden'],
        [app.client(testPrincipal(null)), 'unauthenticated'],
      ] as const;
      const checkRefused = async (client: (typeof refused)[number][0], error: string) => {
        const listed = await client.attempt('audit.entry.query', {});
        expect(listed.ok ? undefined : listed.error.kind).toBe(error);
        const got = await client.attempt('audit.entry.get', { ids: [acmeId] as never });
        expect(got.ok ? undefined : got.error.kind).toBe(error);
      };
      for (const [client, error] of refused) await checkRefused(client, error);
      // A member of acme without the role admin or owner.
      await app.seat('acme', 'member');
      await checkRefused(app.client(adaUser), 'forbidden');
      // Another tenant's admin and operator are in their own scope: they see their own entries only.
      await app.seat('globex');
      for (const client of [app.client(adaUser, 'globex'), app.operator('globex')]) {
        const page = await client.invoke('audit.entry.query', {});
        const own = app.own(page.items);
        expect(own.map((item) => String(item.eventId))).not.toContain(acmeEvent);
        expect(own).toHaveLength(1);
        const got = await client.attempt('audit.entry.get', { ids: [acmeId] as never });
        expect(got.ok ? got.value.list : []).toEqual([]);
      }
    });
  },
);
