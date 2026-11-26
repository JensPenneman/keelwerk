import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { bootAccounts, type StorageKind } from './support/boot-accounts.ts';

const operator = testOperator();
const marked = Temporal.Instant.from('2026-01-01T00:00:00Z');

const settle = (call: Promise<unknown>): Promise<{ code?: string | undefined; value?: unknown }> =>
  call.then(
    (value) => ({ value }),
    (error: { code?: string }) => ({ code: error.code }),
  );

describe.each(['memory', 'pglite'] as const)(
  'the mark of a deactivation is final, on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot() {
      const accounts = await bootAccounts(kind);
      onTestFinished(() => accounts.runtime.stop());
      const admin = accounts.client(operator);
      const enrol = (name: string) =>
        admin.invoke('accounts.profile.create', {
          displayName: name,
          email: `${name.toLowerCase()}@example.org`,
        });
      return { admin, enrol };
    }

    test('a deactivated profile cannot be archived, and nothing of it changes', {
      timeout,
    }, async () => {
      const { admin, enrol } = await boot();
      const { id } = await enrol('Ada');
      const done = await admin.invoke('accounts.profile.deactivate', { id, reason: 'left' });
      const refused = await settle(admin.invoke('accounts.profile.archive', { id }));
      expect(refused.code).toBe('core.not_found');
      const got = await admin.invoke('accounts.profile.get', { ids: [id] });
      expect(got.list[0]).toMatchObject({ id, deactivatedAt: done.deactivatedAt });
      expect(got.list[0]).not.toHaveProperty('archivedAt', expect.anything());
    });

    test('create cannot write the mark', { timeout }, async () => {
      const { admin } = await boot();
      const created = await settle(
        admin.invoke('accounts.profile.create', {
          displayName: 'Eve',
          email: 'eve@example.org',
          deactivatedAt: marked,
        }),
      );
      expect(created.code).toBe('core.forbidden');
      expect((await admin.invoke('accounts.profile.search', { text: 'eve' })).items).toEqual([]);
    });

    test('update cannot write the mark, and other fields still change', { timeout }, async () => {
      const { admin, enrol } = await boot();
      const { id } = await enrol('Ada');
      const updated = await settle(
        admin.invoke('accounts.profile.update', { id, patch: { deactivatedAt: marked } }),
      );
      expect(updated.code).toBe('core.forbidden');
      const patched = await admin.invoke('accounts.profile.update', {
        id,
        patch: { displayName: 'Ada L.' },
      });
      expect(patched).toMatchObject({ displayName: 'Ada L.' });
      expect(patched.deactivatedAt ?? null).toBeNull();
    });

    test('set cannot write the mark in a created or an updated item', { timeout }, async () => {
      const { admin, enrol } = await boot();
      const { id } = await enrol('Ada');
      const created = await settle(
        admin.invoke('accounts.profile.set', {
          create: [{ displayName: 'Eve', email: 'eve@example.org', deactivatedAt: marked }],
        }),
      );
      expect(created.code === undefined ? JSON.stringify(created.value) : created.code).toContain(
        'forbidden',
      );
      const updated = await settle(
        admin.invoke('accounts.profile.set', {
          update: [{ id, patch: { deactivatedAt: marked } }],
        }),
      );
      expect(updated.code === undefined ? JSON.stringify(updated.value) : updated.code).toContain(
        'forbidden',
      );
      expect((await admin.invoke('accounts.profile.search', { text: 'eve' })).items).toEqual([]);
      const row = await admin.invoke('accounts.profile.get', { ids: [id] });
      expect(row.list[0]?.deactivatedAt ?? null).toBeNull();
    });

    test('deactivate still writes the mark', { timeout }, async () => {
      const { admin, enrol } = await boot();
      const { id } = await enrol('Ada');
      const done = await admin.invoke('accounts.profile.deactivate', { id, reason: 'left' });
      expect(done.deactivatedAt).toBeInstanceOf(Temporal.Instant);
    });

    test('an archived living profile is not found by deactivate, and deactivates once restored', {
      timeout,
    }, async () => {
      const { admin, enrol } = await boot();
      const { id } = await enrol('Ada');
      await admin.invoke('accounts.profile.archive', { id });
      const refused = await settle(admin.invoke('accounts.profile.deactivate', { id }));
      expect(refused.code).toBe('core.not_found');
      await admin.invoke('accounts.profile.restore', { id });
      const done = await admin.invoke('accounts.profile.deactivate', { id, reason: 'left' });
      expect(done.deactivatedAt).toBeInstanceOf(Temporal.Instant);
    });
  },
);
