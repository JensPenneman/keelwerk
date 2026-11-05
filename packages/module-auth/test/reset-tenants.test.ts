import { testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { ada, codeOf, enrol } from './support/auth-calls.ts';
import { type BootedAuth, bootAuth, type StorageKind } from './support/boot-auth.ts';

const operator = testOperator();
const fresh = 'a brand new password 42';

describe.each(['memory', 'pglite'] as const)(
  'reset links of auth alone on %s',
  (kind: StorageKind) => {
    const timeout = kind === 'pglite' ? 60_000 : 10_000;

    async function boot(): Promise<BootedAuth> {
      const auth = await bootAuth(kind);
      onTestFinished(() => auth.runtime.stop());
      return auth;
    }

    test('the reset flow runs without accounts', { timeout }, async () => {
      const auth = await boot();
      await enrol(auth);
      const issued = await auth
        .client(operator)
        .invoke('auth.issueResetLink', { identifier: ada.identifier });
      expect(
        (await auth.request('auth.resetPassword', { token: issued.token, newPassword: fresh })).ok,
      ).toBe(true);
      expect((await auth.request('auth.login', { ...ada, password: fresh })).ok).toBe(true);
    });

    test('a link issued in one tenant answers invalid in another, which reads no rows of it', {
      timeout,
    }, async () => {
      const auth = await boot();
      await enrol(auth, ada, 'acme');
      await enrol(auth, ada, 'globex');
      const issued = await auth
        .client(operator, 'acme')
        .invoke('auth.issueResetLink', { identifier: ada.identifier });
      const across = await auth.request(
        'auth.resetPassword',
        { token: issued.token, newPassword: fresh },
        { tenant: 'globex' },
      );
      expect(codeOf(across)).toBe('auth.reset_token_invalid');
      const globex = auth.runtime.tenants.globex;
      if (globex === undefined) throw new Error('no globex tenant');
      const rows = await auth.runtime.adapter.unit(
        auth.runtime.namespace,
        {
          level: 'tenant',
          backendId: auth.runtime.backendId,
          tenantId: globex.id,
        },
        async (unit) => {
          const descriptor = auth.runtime.app.registry.entities.get('auth.resetToken')?.descriptor;
          if (descriptor === undefined) throw new Error('no auth.resetToken');
          return (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) }))
            .rows;
        },
      );
      expect(rows).toEqual([]);
      expect(
        (await auth.request('auth.login', { ...ada, password: fresh }, { tenant: 'globex' })).ok,
      ).toBe(false);
      expect(
        (await auth.request('auth.resetPassword', { token: issued.token, newPassword: fresh })).ok,
      ).toBe(true);
    });
  },
);
