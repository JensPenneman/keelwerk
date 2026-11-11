import { deriveEffectId, kernelCommandId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  command,
  effectsKit,
  receiptOf,
  recordingJobs,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { otherTenant } from './support/invoker-kit.ts';
import { clock, tenant } from './support/run-read-kit.ts';

/** The command id a decision's effect runs under: the kernel form of the effect's derived id. */
const commandIdOf = (cause: string, index: number): string =>
  kernelCommandId('effect', deriveEffectId(tenant, cause, index));

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

const makeBook = (title: string, isbn: string) => (_input: unknown, ctx: Writes) => [
  ctx.write.library.book.create({ title, isbn, addedBy: 'system' }),
];

const invoke = (action: string, input: unknown = {}, over: object = {}) => ({
  kind: 'invoke' as const,
  type: 'invoke',
  action,
  input,
  ...over,
});

describe('invoke', () => {
  test('a sync command of the same scope runs in the unit under the effect id', async () => {
    const registry = registryWith({
      actions: [
        command('launch', (_i: unknown, ctx: Writes) => ({
          events: [ctx.write.library.book.create({ title: 'First', isbn: 'f-1', addedBy: 'ada' })],
          effects: [invoke('library.second')],
        })),
        command('second', makeBook('Second', 's-1')),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {}, { commandId: 'c1' });
    expect(outcome).toMatchObject({ ok: true });
    const { books } = await stored(adapter);
    expect(books.map((book) => book.title).sort()).toEqual(['First', 'Second']);
    const nested = commandIdOf('c1', 0);
    expect((await receiptOf(adapter, nested))?.status).toBe('completed');
    expect((await receiptOf(adapter, 'c1'))?.status).toBe('completed');
  });

  test('a failing savepointed invoke fails the unit: nothing of either command stays', async () => {
    const registry = registryWith({
      actions: [
        command('launch', (_i: unknown, ctx: Writes) => ({
          events: [ctx.write.library.book.create({ title: 'First', isbn: 'f-1', addedBy: 'ada' })],
          effects: [invoke('library.broken')],
        })),
        command('broken', (_i: unknown, ctx: Writes) => {
          ctx.write.library.book.create({ title: 'Lost', isbn: 'l-1', addedBy: 'ada' });
          throw new Error('boom');
        }),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {}, { commandId: 'c1' });
    expect(outcome.ok).toBe(false);
    expect((await stored(adapter)).books).toHaveLength(0);
    expect(await receiptOf(adapter, 'c1')).toBeUndefined();
    expect(await receiptOf(adapter, commandIdOf('c1', 0))).toBeUndefined();
  });

  test('an async command is enqueued with the unit instead of run', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({ effects: [invoke('library.later', { n: 1 })] })),
        command('later', makeBook('Later', 'l-1'), { execution: 'async' }),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    await run('library.launch', {}, { commandId: 'c1' });
    const { books, jobs } = await stored(adapter);
    expect(books).toHaveLength(0);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'action',
      queue: 'commands',
      run: {
        action: 'library.later',
        input: { n: 1 },
        commandId: commandIdOf('c1', 0),
      },
    });
  });

  test('an either command is enqueued only with prefer async', async () => {
    const registry = registryWith({
      actions: [
        command('syncs', () => ({ effects: [invoke('library.either')] })),
        command('asyncs', () => ({ effects: [invoke('library.either', {}, { prefer: 'async' })] })),
        command('either', makeBook('Either', 'e-1'), { execution: 'either' }),
      ],
    });
    const first = effectsKit(registry);
    await first.invoke('library.syncs', {}, { commandId: 'c1' });
    const ran = await stored(first.adapter);
    expect(ran.books).toHaveLength(1);
    expect(ran.jobs).toHaveLength(0);
    const second = effectsKit(registry);
    await second.invoke('library.asyncs', {}, { commandId: 'c2' });
    const queued = await stored(second.adapter);
    expect(queued.books).toHaveLength(0);
    expect(queued.jobs).toHaveLength(1);
  });

  test('a command of a level this unit cannot reach, an unknown command and a prepare command are refused', async () => {
    const registry = registryWith({
      actions: [
        command('toBackend', () => ({ effects: [invoke('library.elsewhere')] })),
        command('toNowhere', () => ({ effects: [invoke('library.nothing')] })),
        command('toPrepared', () => ({ effects: [invoke('library.prepared')] })),
        command('elsewhere', () => [], { scope: 'deployment' }),
        command('prepared', () => [], { prepare: () => ({}) }),
      ],
    });
    const { invoke: run } = effectsKit(registry);
    for (const action of ['toBackend', 'toNowhere', 'toPrepared']) {
      const outcome = await run(`library.${action}`, {});
      expect(outcome).toMatchObject({ ok: false });
      expect(!outcome.ok && outcome.error.code).toBe('core.request_not_allowed');
    }
  });

  test('settle is refused in this release', async () => {
    const registry = registryWith({
      actions: [
        command('settles', () => ({
          effects: [{ kind: 'settle', type: 'settle', effect: 'x', outcome: {} }],
        })),
      ],
    });
    const { invoke: run } = effectsKit(registry);
    const outcome = await run('library.settles', {});
    expect(!outcome.ok && outcome.error.code).toBe('core.request_not_allowed');
  });

  test('an invoke with an input the command rejects is a validation error', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({ effects: [invoke('library.second', { n: 'x' })] })),
        command('second', () => []),
      ],
    });
    const { invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {});
    expect(!outcome.ok && outcome.error.kind).toBe('validation');
  });
});

describe('enqueue', () => {
  test('writes a job row with the build, the revision and the API version', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [
            {
              kind: 'enqueue',
              type: 'enqueue',
              action: 'library.later',
              input: { n: 2 },
              key: 'k-1',
              commandId: 'follow-me',
            },
          ],
        })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    await run('library.launch', {}, { commandId: 'c1' });
    const { jobs } = await stored(adapter);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'action',
      queue: 'commands',
      run: { action: 'library.later', input: { n: 2 }, commandId: 'follow-me' },
      build: { id: 'build-42', revision: 7 },
      apiVersion: '2026-11-01',
      principal: { principalId: 'ada' },
      causation: { commandId: 'c1', actor: { kind: 'user', id: 'ada' } },
      key: { value: 'k-1', onConflict: 'keep' },
    });
    expect(jobs[0]?.scope).toEqual(tenant);
    const other = await stored(adapter, ['commands'], otherTenant);
    expect([other.jobs.length, other.effects.length]).toEqual([0, 0]);
  });

  test('a command of a level this unit cannot reach has no path', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [{ kind: 'enqueue', type: 'enqueue', action: 'library.elsewhere', input: {} }],
        })),
        command('elsewhere', () => [], { scope: 'deployment' }),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {});
    expect(!outcome.ok && outcome.error.code).toBe('core.request_not_allowed');
    expect((await stored(adapter)).jobs).toHaveLength(0);
  });
});

describe('timers', () => {
  const timer = (over: object = {}) => ({
    kind: 'setTimer' as const,
    type: 'setTimer',
    key: 'offline:1',
    action: 'library.later',
    input: {},
    ...over,
  });

  test('setTimer writes a keyed job under the module service principal', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({ effects: [timer({ at: clock.now() })] })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    await run('library.launch', {}, { commandId: 'c1' });
    const { jobs } = await stored(adapter);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      queue: 'timers',
      key: { value: 'offline:1', onConflict: 'replace' },
      principal: { resolver: 'core.module', principalId: 'library.system' },
      build: { id: 'build-42', revision: 7 },
    });
  });

  test('after is a delay from the invocation clock', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({ effects: [timer({ after: '45s' })] })),
        command('later', () => []),
      ],
    });
    const recorded = recordingJobs(effectsKit(registry).adapter);
    const { invoke: run } = effectsKit(registry, { adapter: recorded.adapter });
    await run('library.launch', {});
    expect(recorded.enqueued).toHaveLength(1);
    expect(recorded.enqueued[0]?.runAt?.toString()).toBe(
      clock.now().add({ seconds: 45 }).toString(),
    );
  });

  test('cancelTimer cancels the pending job of the key', async () => {
    const registry = registryWith({
      actions: [
        command('arm', () => ({ effects: [timer({ at: clock.now() })] })),
        command('disarm', () => ({
          effects: [{ kind: 'cancelTimer', type: 'cancelTimer', key: 'offline:1' }],
        })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke: run } = effectsKit(registry);
    await run('library.arm', {});
    await run('library.disarm', {});
    expect((await stored(adapter)).jobs).toHaveLength(0);
  });

  test('a timer without at or after is refused', async () => {
    const registry = registryWith({
      actions: [command('launch', () => ({ effects: [timer()] })), command('later', () => [])],
    });
    const { invoke: run } = effectsKit(registry);
    const outcome = await run('library.launch', {});
    expect(!outcome.ok && outcome.error.code).toBe('core.request_not_allowed');
  });
});

describe('retries', () => {
  test('a retried unit requests the same effect ids and leaves one job', async () => {
    const registry = registryWith({
      actions: [
        command('launch', (_i: unknown, ctx: Writes) => ({
          events: [ctx.write.library.book.create({ title: 'First', isbn: 'f-1', addedBy: 'ada' })],
          effects: [
            { kind: 'enqueue', type: 'enqueue', action: 'library.later', input: {} },
            invoke('library.second'),
          ],
        })),
        command('later', () => []),
        command('second', () => []),
      ],
    });
    const recorded = recordingJobs(effectsKit(registry).adapter, 1);
    const { adapter, invoke: run } = effectsKit(registry, { adapter: recorded.adapter });
    await run('library.launch', {}, { commandId: 'c1' });
    expect(recorded.enqueued).toHaveLength(2);
    expect(recorded.enqueued[0]?.run).toEqual(recorded.enqueued[1]?.run);
    expect(recorded.enqueued[1]?.run).toMatchObject({
      commandId: commandIdOf('c1', 0),
    });
    const { jobs, books } = await stored(adapter);
    expect(jobs).toHaveLength(1);
    expect(books).toHaveLength(1);
    expect((await receiptOf(adapter, commandIdOf('c1', 1)))?.status).toBe('completed');
  });
});
