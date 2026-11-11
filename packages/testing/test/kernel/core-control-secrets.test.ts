import { createHash } from 'node:crypto';
import type { DataAdapterFactory } from '@keelwerk/core';
import {
  canonicalizeJson,
  commandReceiptUuid,
  defineApp,
  defineCommand,
  defineModule,
  defineModuleBase,
  defineRule,
  invoke,
  parseTypeId,
  shape,
} from '@keelwerk/core';
import { memoryAdapter } from '@keelwerk/data';
import { describe, expect, test } from 'vitest';
import { vaultApp } from '../../src/fixtures/index.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { call, callWithId, local, ok, spiedMemory, testClock } from './support/core-actions-kit.ts';
import { boot, deploymentOf, app as libraryApp } from './support/runtime-kit.ts';

const vaultConfig = { vault: { endpoint: 'https://vault.example', signingKey: 'sign-me-secret' } };
const plainDigest = (apiVersion: string, input: unknown): string =>
  createHash('sha256')
    .update(canonicalizeJson({ action: 'core.backend.create', apiVersion, input }))
    .digest('hex');

describe('a create with a secret config (S-111)', () => {
  async function secretStart() {
    const spy = spiedMemory();
    const time = testClock();
    let deploymentId = '';
    const factory: DataAdapterFactory = {
      ...spy.factory,
      create: (placement, env) => {
        deploymentId = env.deploymentId;
        return spy.factory.create(placement, env);
      },
    };
    const runtime = await boot(
      deploymentOf('memory', {
        factory,
        apps: [libraryApp, withTestResolver(vaultApp)],
      }),
      { clock: time.clock },
    );
    return { runtime, spy, time, deployment: () => deploymentId };
  }
  const input = { name: 'vault', app: 'vault', placement: 'main', config: vaultConfig };

  test('the replay seals nothing again, the fingerprint is stable and keyed, and the event digest is too', async () => {
    const { runtime, spy, deployment } = await secretStart();
    const first = await ok(
      callWithId(runtime.invoker, 'core.backend.create', input, 'secret-once'),
    );
    const readRow = async () => {
      const read = await ok(call(runtime.invoker, local, 'core.backend.get', { ids: [first.id] }));
      return (read.list as Record<string, unknown>[])[0];
    };
    const sealed = JSON.stringify((await readRow())?.config);
    const receiptOf = async () => {
      const receipts = await ok(
        call(runtime.invoker, local, 'core.commandReceipt.get', {
          ids: [commandReceiptUuid(deployment(), 'secret-once')],
        }),
      );
      return (receipts.list as Record<string, unknown>[])[0];
    };
    const before = await receiptOf();
    const again = await ok(
      callWithId(runtime.invoker, 'core.backend.create', input, 'secret-once'),
    );
    expect(again.id).toBe(first.id);
    expect(JSON.stringify((await readRow())?.config)).toBe(sealed);
    expect(sealed).toContain(`kwc1.${first.id as string}.vault.signingKey`);
    const after = await receiptOf();
    expect(after?.fingerprint).toBe(before?.fingerprint);
    expect(after?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(after?.fingerprint).not.toBe(plainDigest(String(after?.apiVersion), input));
    const uuid = String(first.id).includes('-')
      ? String(first.id)
      : parseTypeId(String(first.id), 'bknd');
    const [event] = await spy.stream('core.backend', uuid ?? '');
    expect(event?.decision?.inputDigest).toBe(before?.fingerprint);
    expect(
      JSON.stringify(event, (_key, value) => (typeof value === 'bigint' ? String(value) : value)),
    ).not.toContain('sign-me-secret');
  });

  test('a receipt that expires between the read and the claim is no replay: it rolls back and the retry takes the full path', async () => {
    const time = testClock();
    const real = memoryAdapter({ clock: time.clock });
    let armed = false;
    let readReceipt = false;
    const factory: DataAdapterFactory = {
      ...real,
      create: (placement, env) => {
        const adapter = real.create(placement, env);
        const open = adapter.unit.bind(adapter);
        adapter.unit = (namespace, scope, fn, options) => {
          // The unit after the one that read the receipt starts a month later: the receipt expired.
          if (readReceipt) {
            readReceipt = false;
            armed = false;
            time.advance({ hours: 720 });
          }
          return open(
            namespace,
            scope,
            async (unit) => {
              const receipts = {
                ...unit.receipts,
                get: async (id: string) => {
                  const found = await unit.receipts.get(id);
                  if (armed && found !== undefined) readReceipt = true;
                  return found;
                },
              };
              return fn({ ...unit, receipts });
            },
            options,
          );
        };
        return adapter;
      },
    };
    const runtime = await boot(
      deploymentOf('memory', { factory, apps: [libraryApp, withTestResolver(vaultApp)] }),
      { clock: time.clock },
    );
    const first = await ok(callWithId(runtime.invoker, 'core.backend.create', input, 'expiring'));
    armed = true;
    const raced = await callWithId(runtime.invoker, 'core.backend.create', input, 'expiring');
    expect(raced).toMatchObject({
      ok: false,
      error: { code: 'core.command_in_progress', retryable: true },
    });
    const rows = await ok(call(runtime.invoker, local, 'core.backend.query', {}));
    const items = rows.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(first.id);
    expect(JSON.stringify(items)).not.toContain('sign-me-secret');
    expect(JSON.stringify(items[0]?.config)).toContain('kwc1.');
    // The retry takes the full path, whose checks see the backend that exists.
    expect(
      await callWithId(runtime.invoker, 'core.backend.create', input, 'expiring'),
    ).toMatchObject({
      ok: false,
      error: { kind: 'conflict' },
    });
  });
});

describe('a nested invoke of a control command', () => {
  test('core.backend.create is refused inside another command, and nothing is created', async () => {
    const base = defineModuleBase({ id: 'nest', version: '0.1.0' });
    const launch = defineCommand(base, {
      input: shape({}),
      scope: 'deployment',
      principal: 'operator',
      decide: () => ({
        events: [],
        effects: [invoke('core.backend.create', { name: 'x', app: 'library', placement: 'main' })],
      }),
    });
    const nest = withTestResolver(
      defineApp({
        id: 'nest-app',
        modules: [
          defineModule(base, {
            actions: { launch },
            policies: {
              launch: {
                operators: defineRule(base, launch, { effect: 'allow', principal: 'operator' }),
              },
            },
          }),
        ],
      }),
    );
    const runtime = await boot(deploymentOf('memory', { apps: [nest, libraryApp] }));
    const outcome = await call(runtime.invoker, local, 'nest.launch', {});
    expect(outcome).toMatchObject({ ok: false, error: { kind: 'forbidden' } });
    // The refusal reaches the caller as the closed projection: the registered message, not the nested text.
    expect(outcome).toMatchObject({
      error: { code: 'core.forbidden', message: 'The caller is not allowed to do this.' },
    });
    const rows = await ok(call(runtime.invoker, local, 'core.backend.query', {}));
    expect(rows.items).toEqual([]);
  });
});
