import { coreApiVersions } from '@keelwerk/core';
import { afterEach, describe, expect, test } from 'vitest';
import { libraryApp } from '../../src/fixtures/index.ts';
import type { TestApp } from '../../src/harness/test-app.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import { olderVersion, redactApp } from './support/redact-app.ts';
import { startExplain } from './support/started-explain.ts';
import { bootVault } from './support/vault-kit.ts';

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.allSettled(cleanup.splice(0).map((close) => close()));
});

const started = (app: TestApp = libraryApp) => startExplain(app, cleanup);

describe('core.explain mode redecide (7.9.6)', () => {
  test('core.explain redecide of a generated library.book.update reports reproduced', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await started();
    const made = await command(
      'library.book.create',
      { title: 'Dune', isbn: '1', addedBy: 'ada' },
      '00000000-0000-7000-8000-0000000000a1',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = { id, patch: { title: 'Dune Messiah' }, ifVersion: 1 };
    const updated = await command(
      'library.book.update',
      input,
      '00000000-0000-7000-8000-0000000000a2',
    );
    if (!updated.ok) throw updated.error;
    const answer = await explain({
      mode: 'redecide',
      commandId: '00000000-0000-7000-8000-0000000000a2',
      input,
    });
    if (!answer.ok) throw answer.error;
    expect(answer.value).toMatchObject({
      mode: 'redecide',
      part: 'library.book.update',
      reproduced: true,
      differences: [],
    });
  });

  test('without a kept input and without input it answers validation', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await started();
    const made = await command(
      'library.book.create',
      { title: 'Dune', isbn: '1', addedBy: 'ada' },
      '00000000-0000-7000-8000-0000000000b1',
    );
    if (!made.ok) throw made.error;
    const answer = await explain({
      mode: 'redecide',
      commandId: '00000000-0000-7000-8000-0000000000b1',
    });
    expect(answer).toMatchObject({
      ok: false,
      error: { kind: 'validation', message: expect.stringContaining('did not keep its input') },
    });
    const none = await explain({ mode: 'redecide' });
    expect(none).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  test('of a command that kept its input sealed it needs no input', {
    timeout: 60_000,
  }, async () => {
    const vault = await bootVault('memory');
    const commandId = '00000000-0000-7000-8000-0000000000c1';
    const stored = await vault.call('vault.store', { label: 'ci' }, commandId);
    expect(stored.ok).toBe(true);
    const answer = await vault.explain({ mode: 'redecide', commandId });
    if (!answer.ok) throw answer.error;
    expect(answer.value).toMatchObject({
      mode: 'redecide',
      part: 'vault.store',
      reproduced: true,
      differences: [],
    });
  });
  test('a personal or hidden value appears nowhere in the answer: it is redacted as a dry run redacts it', {
    timeout: 60_000,
  }, async () => {
    const { command, explain } = await started(redactApp);
    const made = await command(
      'clinic.patient.create',
      { name: 'Ada', ownerId: 'ada', email: 'first@secret.example', ward: 'ward-first-secret' },
      '00000000-0000-7000-8000-0000000000d1',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = {
      id,
      patch: { email: 'second@secret.example', ward: 'ward-second-secret' },
      ifVersion: 1,
    };
    const updated = await command(
      'clinic.patient.update',
      input,
      '00000000-0000-7000-8000-0000000000d2',
    );
    if (!updated.ok) throw updated.error;
    const answer = await explain({
      mode: 'redecide',
      commandId: '00000000-0000-7000-8000-0000000000d2',
      input,
    });
    if (!answer.ok) throw answer.error;
    expect(answer.value).toMatchObject({ mode: 'redecide', reproduced: true, differences: [] });
    const shown = JSON.stringify(answer.value);
    for (const value of [
      'first@secret.example',
      'second@secret.example',
      'ward-first-secret',
      'ward-second-secret',
    ]) {
      expect(shown, value).not.toContain(value);
    }
    expect(shown).toContain('[redacted]');
  });

  test('a session on another API version re-decides by the receipt version; with the receipt purged it fails naming the version and reproduces with apiVersion', {
    timeout: 60_000,
  }, async () => {
    const { runtime, command, explain } = await started(redactApp);
    const commandId = '00000000-0000-7000-8000-0000000000e2';
    const made = await command(
      'clinic.patient.create',
      { name: 'Ada', ownerId: 'ada' },
      '00000000-0000-7000-8000-0000000000e1',
    );
    if (!made.ok) throw made.error;
    const { id } = made.value as { id: string };
    const input = { id, patch: { name: 'Ada L.' }, ifVersion: 1 };
    const updated = await command('clinic.patient.update', input, commandId, {
      apiVersion: olderVersion,
    });
    if (!updated.ok) throw updated.error;
    // The operator's session is on the core's head version; the receipt holds the one the command ran in.
    const byReceipt = await explain({ mode: 'redecide', commandId, input });
    if (!byReceipt.ok) throw byReceipt.error;
    expect(byReceipt.value).toMatchObject({ reproduced: true, differences: [] });

    const address = tenantAddress(runtime, 'acme');
    const receipts = runtime.app.registry.entities.get('core.commandReceipt');
    if (receipts === undefined) throw new Error('the app has no receipts');
    await runtime.adapter.unit(address.namespace, address.scope, async (unit) => {
      const row = await unit.rows.findOne(receipts.descriptor, {
        where: { op: 'eq', field: 'commandId', value: commandId },
      });
      if (row === undefined) throw new Error('the receipt is missing');
      await unit.rows.purge(receipts.descriptor, [String(row.id)]);
    });
    const purged = await explain({ mode: 'redecide', commandId, input });
    expect(purged).toMatchObject({
      ok: false,
      error: {
        kind: 'validation',
        message: expect.stringContaining(`API version "${coreApiVersions.head}"`),
      },
    });
    const given = await explain({ mode: 'redecide', commandId, input, apiVersion: olderVersion });
    if (!given.ok) throw given.error;
    expect(given.value).toMatchObject({ reproduced: true, differences: [] });
  });
});
