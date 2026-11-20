import { testPrincipal } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { type AuditStorage, aloneApp, bootAudit } from './support/boot-audit.ts';
import { adaSubject, adaUser, adminAda, graceUser, ownerGrace } from './support/people.ts';

describe.each(['memory', 'pglite'] as const)(
  'who reads the audit trail on %s',
  (kind: AuditStorage) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const app = await bootAudit(aloneApp, kind);
      onTestFinished(() => app.runtime.stop());
      await app.client(adaUser, 'acme').invoke('notes.note.create', { title: 'a' });
      await app.client(adaUser, 'globex').invoke('notes.note.create', { title: 'g' });
      await app.settle();
      return app;
    }

    // The local client sends no tenant marker, so the edge rule of the operator's entry does not apply
    // here: an operator who has not entered a tenant is refused `core.tenant_not_entered` for a tenant
    // action of any module, which packages/testing/test/kernel/tenant-entry.test.ts proves
    // ("a marker without an entry is core.tenant_not_entered", on library.book.query).
    test("an operator's client scoped to the tenant and its admin or owner read the entries", {
      timeout,
    }, async () => {
      const app = await boot();
      for (const client of [app.operator('acme'), app.client(adminAda), app.client(ownerGrace)]) {
        const page = await client.invoke('audit.entry.query', {});
        expect(page.items.map((item) => item.eventType)).toEqual(['notes.note.created']);
        expect(page.items[0]?.subject).toBe(adaSubject);
      }
      const [one] = await app.entries();
      const got = await app
        .client(adminAda)
        .invoke('audit.entry.get', { ids: [String(one?.id)] as never });
      expect(got.list).toHaveLength(1);
    });

    test("a member without the role, a plain user, an anonymous caller and globex's admin and an operator's client scoped to globex read none of acme's", {
      timeout,
    }, async () => {
      const app = await boot();
      const [acmeEntry] = await app.entries('acme');
      const acmeId = String(acmeEntry?.id);
      const acmeEvent = String(acmeEntry?.eventId);
      const refused = [
        [app.client(testPrincipal(adaSubject, { roles: ['member'] })), 'forbidden'],
        [app.client(graceUser), 'forbidden'],
        [app.client(testPrincipal(null)), 'unauthenticated'],
      ] as const;
      for (const [client, kind] of refused) {
        const listed = await client.attempt('audit.entry.query', {});
        expect(listed.ok ? undefined : listed.error.kind).toBe(kind);
        const got = await client.attempt('audit.entry.get', { ids: [acmeId] as never });
        expect(got.ok ? undefined : got.error.kind).toBe(kind);
      }
      // Another tenant's admin and operator are in their own scope: they see their own entries only.
      for (const client of [app.client(adminAda, 'globex'), app.operator('globex')]) {
        const page = await client.invoke('audit.entry.query', {});
        expect(page.items.map((item) => String(item.eventId))).not.toContain(acmeEvent);
        expect(page.items).toHaveLength(1);
        const got = await client.attempt('audit.entry.get', { ids: [acmeId] as never });
        expect(got.ok ? got.value.list : []).toEqual([]);
      }
    });
  },
);
