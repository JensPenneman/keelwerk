import { defineApp } from '@keelwerk/core';
import { accounts } from '@keelwerk/module-accounts';
import { startTestRuntime, testOperator } from '@keelwerk/testing';
import { describe, expect, onTestFinished, test } from 'vitest';
import { auth } from '../src/module.generated.ts';
import { ada, codeOf, grace } from './support/auth-calls.ts';
import type { StorageKind } from './support/boot-auth.ts';
import { type BootedBoth, bootBoth } from './support/boot-both.ts';
import { importer } from './support/importer-module.ts';

const operator = testOperator();

describe.each(['memory', 'pglite'] as const)('profile linking on %s', (kind: StorageKind) => {
  const timeout = kind === 'pglite' ? 60_000 : 10_000;

  async function boot(settings?: Parameters<typeof bootBoth>[1]): Promise<BootedBoth> {
    const both = await bootBoth(kind, settings);
    onTestFinished(() => both.runtime.stop());
    return both;
  }

  // a credential that was created before accounts was selected: no profile link, no pending link
  async function insertOlderCredential(both: BootedBoth): Promise<string> {
    const older = crypto.randomUUID();
    await both.inUnit(
      async (unit) => {
        const descriptor = both.runtime.app.registry.entities.get('auth.credential')?.descriptor;
        if (descriptor === undefined) throw new Error('no auth.credential');
        const now = both.clock.now();
        await unit.rows.insert(descriptor, [
          {
            id: crypto.randomUUID(),
            subject: older,
            kind: 'password',
            identifier: ada.identifier,
            verifier: 'not a hash',
            linkPending: false,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      },
      { sealed: true },
    );
    return older;
  }

  test('a profile registered by someone else does not claim an older unlinked credential of the address', {
    timeout,
  }, async () => {
    const both = await boot();
    const older = await insertOlderCredential(both);
    await both.client(operator).invoke('accounts.register', {
      displayName: 'Ada',
      email: ada.identifier,
    });
    const [credential] = await both.rows('auth.credential', { sealed: true });
    expect(credential?.profileId).toBeUndefined();
    expect(credential?.subject).toBe(older);
  });

  test('a system-invoked registration does not claim an older unlinked credential of the address', {
    timeout,
  }, async () => {
    const runtime = await startTestRuntime(
      defineApp({ id: 'importing', modules: [accounts, auth, importer] as const }),
      {
        adapter: kind,
        operators: true,
        tenants: ['acme'],
        config: { accounts: { allowSelfRegistration: true }, auth: {} },
      },
    );
    onTestFinished(() => runtime.stop());
    const tenant = runtime.tenants.acme;
    const descriptor = runtime.app.registry.entities.get('auth.credential')?.descriptor;
    if (descriptor === undefined) throw new Error('no auth.credential');
    const older = crypto.randomUUID();
    await runtime.sealed.unit(
      runtime.namespace,
      { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id },
      async (unit) => {
        const now = Temporal.Now.instant();
        await unit.rows.insert(descriptor, [
          {
            id: crypto.randomUUID(),
            subject: older,
            kind: 'password',
            identifier: ada.identifier,
            verifier: 'not a hash',
            linkPending: false,
            version: 1,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      },
    );
    // grace signs up; the importer registers ada's address as the system in the same unit
    const done = await runtime.invoker.invoke({
      action: 'auth.signUp',
      input: grace,
      carrier: { transport: 'test', headers: { 'x-tenant': tenant.id } },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
    expect(done.ok).toBe(true);
    const rows = await runtime.sealed.unit(
      runtime.namespace,
      { level: 'tenant', backendId: runtime.backendId, tenantId: tenant.id },
      async (unit) =>
        (await unit.rows.find(descriptor, { select: Object.keys(descriptor.fields) })).rows,
    );
    const adas = rows.find((row) => row.identifier === ada.identifier);
    const graces = rows.find((row) => row.identifier === grace.identifier);
    expect(adas?.profileId).toBeUndefined();
    expect(adas?.subject).toBe(older);
    expect(graces?.profileId).toBeDefined();
    expect(graces?.linkPending).toBe(false);
  });

  test("Ada signs up, registration is turned off, Ada's address answers core.forbidden", {
    timeout,
  }, async () => {
    const both = await boot({ accounts: { allowSelfRegistration: false } });
    await insertOlderCredential(both);
    expect(codeOf(await both.request('auth.signUp', ada))).toBe('core.forbidden');
    expect(codeOf(await both.request('auth.signUp', grace))).toBe('core.forbidden');
  });
});
