import { dryRun, normalizeRule } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { addBooks, behaviours, commandKit, runDirect } from './support/command-kit.ts';
import {
  credentialProbes,
  firstId,
  mismatchRefusal,
  putReceipt,
  secondId,
  storedReceipt,
  thirdId,
  visible,
} from './support/credential-replay-kit.ts';
import { deriveOnlyKeys } from './support/derive-only-keys.ts';
import { plainFingerprint } from './support/erasure-dump-tools.ts';
import { byHeaderCarrier, call } from './support/invoker-kit.ts';
import {
  anonymous,
  clock,
  namespace,
  silent,
  tenant,
  userOf,
  uuid,
} from './support/run-read-kit.ts';
import { refusal } from './support/runtime-kit.ts';

describe('a finished command repeated by a caller without a principal reference (WP-181)', () => {
  test('a receipt in the 0.1.0 form is refused alike', async () => {
    const calls = { n: 0 };
    const { registry, ref } = credentialProbes(calls);
    const { adapter } = commandKit({ registry });
    const run = (commandId: string, input: unknown) =>
      runDirect({
        registry,
        adapter,
        action: ref('door'),
        input,
        commandId,
        principal: anonymous,
      });
    const [bookId] = await addBooks(adapter, 1);
    const input = { id: bookId, pin: '4711' };
    await run(firstId, input);
    const stamped = await storedReceipt(adapter, firstId);
    await putReceipt(adapter, {
      ...stamped,
      commandId: secondId,
      fingerprint: plainFingerprint(ref('door'), '2026-11-04', input),
    });
    const same = visible(await refusal(run(secondId, input)));
    expect(same).toMatchObject(mismatchRefusal);
    expect(visible(await refusal(run(secondId, { id: bookId, pin: '0000' })))).toEqual(same);
  });

  test('the asynchronous path and the explain dry run answer the same refusal', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter, invoker } = commandKit({ registry });
    const input = { door: 'front', pin: '4711' };
    const send = (prefer?: 'async') =>
      invoker.invoke(
        call(ref('gate'), input, {
          carrier: byHeaderCarrier,
          commandId: firstId,
          ...(prefer === undefined ? {} : { prefer }),
        }),
      );
    expect((await send()).ok).toBe(true);
    const asynchronous = await send('async');
    if (asynchronous.ok) throw new Error('the async repeat must be refused');
    expect(visible(asynchronous.error)).toMatchObject(mismatchRefusal);
    const action = registry.actions.get(ref('gate'));
    if (action === undefined) throw new Error('no gate');
    const explained = await refusal(
      dryRun({
        registry,
        adapter,
        namespace,
        scope: tenant,
        action,
        input,
        commandId: firstId,
        principal: anonymous,
        request: { transport: 'test', requestId: 'r1' },
        clock,
        keys: deriveOnlyKeys,
        compute: {} as never,
        log: silent,
        trace: {} as never,
        rules: [...registry.rules.values()]
          .filter((rule) => rule.disabled !== true)
          .map(normalizeRule),
        apiVersion: '2026-11-04',
        build: { id: 'test', revision: 1 },
        behaviours,
        concurrentUnits: true,
        retry: { sleep: async () => undefined },
      }),
    );
    expect(visible(explained)).toEqual(visible(asynchronous.error));
  });

  test('the system principal is refused alike', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const system = {
      kind: 'system',
      reason: 'test',
      scope: anonymous.scope,
      claims: {},
      roles: [],
      memberships: [],
      via: 'core.system',
      ref: null,
    } as never;
    const run = () =>
      runDirect({
        registry,
        adapter,
        action: ref('gate'),
        input: { door: 'front', pin: '4711' },
        commandId: firstId,
        principal: system,
      });
    await run();
    expect(visible(await refusal(run()))).toMatchObject(mismatchRefusal);
  });

  test('a pending receipt still answers core.command_in_progress', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const input = { door: 'front', pin: '4711' };
    const run = (commandId: string) =>
      runDirect({
        registry,
        adapter,
        action: ref('gate'),
        input,
        commandId,
        principal: anonymous,
      });
    await run(firstId);
    await putReceipt(adapter, {
      ...(await storedReceipt(adapter, firstId)),
      commandId: thirdId,
      status: 'pending',
      outcome: null,
    });
    expect(await refusal(run(thirdId))).toMatchObject({ code: 'core.command_in_progress' });
  });

  test('a caller with a principal reference is replayed as before, with another secret too', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const principal = {
      ...userOf('ada'),
      ref: { resolver: 'test.token', principalId: uuid(91) },
    } as never;
    const [bookId] = await addBooks(adapter, 1);
    const run = (pin: string) =>
      runDirect({
        registry,
        adapter,
        action: ref('door'),
        input: { id: bookId, pin },
        commandId: firstId,
        principal,
      });
    const first = await run('4711');
    expect(first.replayed).toBeUndefined();
    for (const pin of ['4711', '0000']) {
      const again = await run(pin);
      expect(again.replayed).toBe(true);
      expect(again.output).toEqual(first.output);
    }
  });

  test('an action without a credential member is replayed to an anonymous caller as before', async () => {
    const { registry, ref } = credentialProbes({ n: 0 });
    const { adapter } = commandKit({ registry });
    const run = () =>
      runDirect({
        registry,
        adapter,
        action: ref('plain'),
        input: { door: 'front', note: 'n' },
        commandId: firstId,
        principal: anonymous,
      });
    await run();
    expect((await run()).replayed).toBe(true);
  });
});
