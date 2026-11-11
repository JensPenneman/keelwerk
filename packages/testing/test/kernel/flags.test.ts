import type { FlagRead } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { libraryApp } from '../../src/fixtures/index.ts';
import { expectReproduces } from '../../src/replay/expect-reproduces.ts';
import { bootFlags, flagsApp, variables } from './support/flags-kit.ts';

const book = { title: 'Dune', isbn: '978-0441172719' };

describe('flags in the pipeline', () => {
  test("with KEELWERK_FLAG_LIBRARY_NEW_FLOW=true library.addFeaturedBook runs and its event's meta.flags records the read", async () => {
    const { call, events } = await bootFlags(libraryApp, {
      env: variables(['KEELWERK_FLAG_LIBRARY_NEW_FLOW', 'true']),
    });
    const outcome = await call('library.addFeaturedBook', book, crypto.randomUUID());
    expect(outcome).toMatchObject({ ok: true, value: { newFlow: true } });
    const flags: readonly FlagRead[] = (await events()).flatMap((event) => event.flags);
    expect(flags).toEqual([
      { key: 'library.newFlow', variant: 'true', reason: 'STATIC', ruleVersion: null },
    ]);
  });

  test('without the variable it answers forbidden core.feature_disabled with rule library.addFeaturedBook.gate', async () => {
    const { call, events } = await bootFlags(libraryApp);
    const outcome = await call('library.addFeaturedBook', book, crypto.randomUUID());
    expect(outcome).toMatchObject({
      ok: false,
      error: {
        kind: 'forbidden',
        code: 'core.feature_disabled',
        rules: [{ id: 'library.addFeaturedBook.gate', effect: 'deny' }],
      },
    });
    expect(await events()).toEqual([]);
    expect(await call('library.addBook', book, crypto.randomUUID())).toMatchObject({ ok: true });
  });

  test('a kill-switch gate answers unavailable core.feature_suspended at admit', async () => {
    const env: Record<string, string | undefined> = {};
    const variable = 'KEELWERK_FLAG_GATES_LIVE';
    const { call } = await bootFlags(flagsApp, { env });
    expect(await call('gates.suspendable', {})).toMatchObject({ ok: true, value: { ran: true } });
    env[variable] = 'false';
    expect(await call('gates.suspendable', {})).toMatchObject({
      ok: false,
      error: { kind: 'unavailable', code: 'core.feature_suspended', retryable: true },
    });
    env[variable] = 'true';
    expect(await call('gates.suspendable', {})).toMatchObject({ ok: true });
  });

  test('a module gate refuses every action the module mounts', async () => {
    const env: Record<string, string | undefined> = {};
    const { call } = await bootFlags(flagsApp, { env });
    for (const action of ['walled.touch', 'walled.peek']) {
      expect(await call(action, {})).toMatchObject({
        ok: false,
        error: {
          kind: 'forbidden',
          code: 'core.feature_disabled',
          rules: [{ id: 'walled.gate', effect: 'deny' }],
        },
      });
    }
    env.KEELWERK_FLAG_WALLED_OPEN = 'true';
    for (const action of ['walled.touch', 'walled.peek']) {
      expect(await call(action, {})).toMatchObject({ ok: true, value: { ran: true } });
    }
  });

  test('a throwing provider serves the default with ERROR and the call succeeds', async () => {
    const asked: string[] = [];
    const { call } = await bootFlags(flagsApp, {
      flagProviders: [
        {
          id: 'broken',
          sync: true,
          start: () => Promise.resolve(),
          resolve: (flag) => {
            asked.push(flag.key);
            throw new Error('the flag service is down');
          },
        },
      ],
    });
    expect(await call('gates.detail', {})).toMatchObject({
      ok: true,
      value: { reason: 'ERROR', errorCode: 'GENERAL', provider: 'broken' },
    });
    expect(await call('gates.record', { text: 'a' }, crypto.randomUUID())).toMatchObject({
      ok: true,
      value: { beta: false },
    });
    expect(asked).toContain('gates.beta');
  });

  test('a policy whose condition reads a flag sees the snapshot value', async () => {
    const env: Record<string, string | undefined> = {};
    const { call } = await bootFlags(flagsApp, { env });
    expect(await call('gates.guarded', {})).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', code: 'core.forbidden' },
    });
    env.KEELWERK_FLAG_GATES_BETA = 'true';
    expect(await call('gates.guarded', {})).toMatchObject({ ok: true, value: { ran: true } });
  });

  test('a command invoked from a decision has its gate rules read the snapshot value', async () => {
    const env: Record<string, string | undefined> = {};
    const { call } = await bootFlags(flagsApp, { env });
    expect(await call('gates.relay', {}, crypto.randomUUID())).toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    });
    env.KEELWERK_FLAG_GATES_BETA = 'true';
    expect(await call('gates.relay', {}, crypto.randomUUID())).toMatchObject({
      ok: true,
      value: { relayed: true },
    });
  });

  test('a read rule whose where narrows on a flag gives different rows with and without the variable', async () => {
    const env: Record<string, string | undefined> = {};
    const { call } = await bootFlags(flagsApp, { env });
    for (const text of ['public', 'secret']) {
      expect(await call('gates.record', { text }, crypto.randomUUID())).toMatchObject({ ok: true });
    }
    const texts = async (): Promise<readonly string[]> => {
      const page = await call<{ items: readonly { text: string }[] }>('gates.note.query', {});
      expect(page.ok).toBe(true);
      return page.ok ? page.value.items.map((item) => item.text).sort() : [];
    };
    expect(await texts()).toEqual(['public']);
    env.KEELWERK_FLAG_GATES_BETA = 'true';
    expect(await texts()).toEqual(['public', 'secret']);
    delete env.KEELWERK_FLAG_GATES_BETA;
    expect(await texts()).toEqual(['public']);
  });

  test('the state token resets when a flag a read rule narrows on flips', async () => {
    const env: Record<string, string | undefined> = {};
    const { call } = await bootFlags(flagsApp, { env });
    expect(await call('gates.record', { text: 'public' }, crypto.randomUUID())).toMatchObject({
      ok: true,
    });
    expect(await call('gates.record', { text: 'secret' }, crypto.randomUUID())).toMatchObject({
      ok: true,
    });
    const page = await call<{ queryState: string }>('gates.note.query', {});
    expect(page.ok).toBe(true);
    const since = page.ok ? page.value.queryState : '';
    const steady = await call<{ cannotCalculateChanges?: boolean }>('gates.note.queryChanges', {
      sinceQueryState: since,
    });
    expect(steady).toMatchObject({ ok: true });
    expect(steady.ok && steady.value.cannotCalculateChanges).not.toBe(true);
    env.KEELWERK_FLAG_GATES_BETA = 'true';
    const flipped = await call<{ cannotCalculateChanges?: boolean }>('gates.note.queryChanges', {
      sinceQueryState: since,
    });
    expect(flipped).toMatchObject({ ok: true, value: { cannotCalculateChanges: true } });
  });
});

describe('re-deciding with flags', () => {
  test('re-decide reproduces a decision recorded with the flag on after the variable is unset', async () => {
    const env: Record<string, string | undefined> = {};
    const variable = 'KEELWERK_FLAG_GATES_BETA';
    env[variable] = 'true';
    const { runtime, call, events } = await bootFlags(flagsApp, { env });
    const commandId = crypto.randomUUID();
    const input = { text: 'hello' };
    expect(await call('gates.record', input, commandId)).toMatchObject({
      ok: true,
      value: { beta: true },
    });
    expect((await events()).flatMap((event) => event.flags)).toEqual([
      { key: 'gates.beta', variant: 'true', reason: 'STATIC', ruleVersion: null },
    ]);
    delete env[variable];
    const result = await expectReproduces(runtime, { commandId, input });
    expect(result).toMatchObject({ reproduced: true, differences: [] });
    expect(await call('gates.record', input, crypto.randomUUID())).toMatchObject({
      value: { beta: false },
    });
  });

  test("re-decide reproduces an M1-shaped record: meta.flags exactly { key, variant: 'false', reason: 'DEFAULT', ruleVersion: null }", async () => {
    const { runtime, call, events } = await bootFlags(flagsApp);
    const commandId = crypto.randomUUID();
    const input = { text: 'plain' };
    expect(await call('gates.record', input, commandId)).toMatchObject({
      ok: true,
      value: { beta: false },
    });
    const recorded = (await events()).flatMap((event) => event.flags);
    expect(recorded).toEqual([
      { key: 'gates.beta', variant: 'false', reason: 'DEFAULT', ruleVersion: null },
    ]);
    expect(Object.keys(recorded[0] ?? {}).sort()).toEqual([
      'key',
      'reason',
      'ruleVersion',
      'variant',
    ]);
    const result = await expectReproduces(runtime, { commandId, input });
    expect(result).toMatchObject({ reproduced: true, differences: [] });
  });
});
