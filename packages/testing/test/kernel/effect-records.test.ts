import { deriveEffectId, field, shape } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  command,
  effectsKit,
  eventsOf,
  externalEffect,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { otherTenant } from './support/invoker-kit.ts';
import { tenant } from './support/run-read-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

const notify = (over: object = {}) => ({
  kind: 'external' as const,
  type: 'library.notify',
  input: { to: 'ada@example.org' },
  ...over,
});

const parts = (over: Parameters<typeof externalEffect>[2] = {}) => {
  const declared = externalEffect('notify', async () => ({ ok: true }), over);
  return {
    effects: [declared.effect],
    executors: [declared.executor],
  };
};

describe('external effect records', () => {
  test('a decision leaves a requested record, its stream and an effect job', async () => {
    const deadline = Temporal.Instant.from('2026-02-01T00:00:00Z');
    const registry = registryWith({
      ...parts({
        queue: 'mail',
        capability: ['smtp-out'],
        retry: { delays: ['30s'] },
        timeout: '30s',
      }),
      actions: [
        command('send', (_i: unknown, ctx: Writes) => ({
          events: [ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' })],
          effects: [
            notify({ continueWith: 'library.after', with: { id: 'x' }, key: 'k-1', deadline }),
          ],
        })),
        command('after', () => []),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.send', {}, { commandId: 'c1' });
    const id = deriveEffectId(tenant, 'c1', 0);
    expect(outcome).toMatchObject({ ok: true, effects: [id] });
    const { effects, jobs, books } = await stored(adapter, ['mail']);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      id,
      type: 'library.notify',
      commandId: 'c1',
      status: 'requested',
      attempts: 0,
      performer: 'executor',
      input: { to: 'ada@example.org' },
      continuation: 'library.after',
      continuationWith: { id: 'x' },
      key: 'k-1',
    });
    expect(effects[0]?.eventIds).toHaveLength(1);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      kind: 'effect',
      queue: 'mail',
      run: { executor: 'library.notify', effect: id },
      capability: ['smtp-out'],
      retry: { delays: ['30s'] },
      expireInSeconds: 30,
      principal: { resolver: 'core.module', principalId: 'library.system' },
      build: { id: 'build-42', revision: 7 },
    });
    const stream = await eventsOf(adapter, 'core.effect', id);
    expect(stream).toHaveLength(1);
    expect(stream[0]).toMatchObject({ type: 'core.effect.created', commandId: 'c1' });
    const [bookEvent] = await eventsOf(adapter, 'library.book', String(books[0]?.id));
    expect(bookEvent?.decision?.effects).toEqual([id]);
    expect(effects[0]?.eventIds).toEqual([bookEvent?.eventId]);
    const other = await stored(adapter, ['mail'], otherTenant);
    expect([other.effects.length, other.jobs.length, other.books.length]).toEqual([0, 0, 0]);
  });

  test('an effect with an outside performer leaves the record and no job', async () => {
    const declared = externalEffect(
      'notify',
      async () => ({ ok: true }),
      {},
      {
        performer: 'external',
        executor: null,
      },
    );
    const registry = registryWith({
      effects: [declared.effect],
      actions: [command('send', () => ({ effects: [notify()] }))],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.send', {}, { commandId: 'c1' });
    const { effects, jobs } = await stored(adapter);
    expect(effects[0]).toMatchObject({ status: 'requested', performer: 'external' });
    expect(jobs).toHaveLength(0);
  });

  test('a reaction cause derives its own ids', async () => {
    const registry = registryWith({
      ...parts(),
      actions: [
        command('add', (_i: unknown, ctx: Writes) => [
          ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' }),
        ]),
      ],
      reactions: [
        {
          id: 'library.notifies',
          module: 'library',
          on: ['library.book.created'],
          timing: 'inline',
          ordering: 'none',
          coalesce: false,
          process: false,
          when: [],
          react: () => ({ effects: [notify()] }),
        },
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const outcome = await invoke('library.add', {}, { commandId: 'c1' });
    const { effects, books } = await stored(adapter);
    const [created] = await eventsOf(adapter, 'library.book', String(books[0]?.id));
    const id = deriveEffectId(tenant, `library.notifies:${created?.eventId}`, 0);
    expect(outcome).toMatchObject({ ok: true, effects: [id] });
    expect(effects.map((row) => row.id)).toEqual([id]);
  });

  test('an unknown effect, an invalid input and a failing command leave nothing', async () => {
    const registry = registryWith({
      ...parts(),
      actions: [
        command('unknown', () => ({ effects: [notify({ type: 'library.nothing' })] })),
        command('invalid', () => ({ effects: [notify({ input: { to: 5 } })] })),
        command('fails', (_i: unknown, ctx: Writes) => {
          ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' });
          return {
            effects: [
              notify(),
              { kind: 'invoke', type: 'invoke', action: 'library.nope', input: {} },
            ],
          };
        }),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const unknown = await invoke('library.unknown', {});
    const invalid = await invoke('library.invalid', {});
    const fails = await invoke('library.fails', {});
    expect(!unknown.ok && unknown.error.code).toBe('core.request_not_allowed');
    expect(!invalid.ok && invalid.error.kind).toBe('validation');
    expect(fails.ok).toBe(false);
    const { effects, jobs, books } = await stored(adapter);
    expect([effects.length, jobs.length, books.length]).toEqual([0, 0, 0]);
  });

  test('an effect whose input declares a personal field is refused until sealing ships; a secret field is sealed', async () => {
    const declared = externalEffect(
      'notify',
      async () => ({ ok: true }),
      {},
      { input: shape({ to: field.string().personal() }) },
    );
    const secret = externalEffect(
      'token',
      async () => ({ ok: true }),
      {},
      { input: shape({ key: field.secret() }) },
    );
    const registry = registryWith({
      effects: [declared.effect, secret.effect],
      executors: [declared.executor, secret.executor],
      actions: [
        command('sendPersonal', () => ({ effects: [notify()] })),
        command('sendSecret', () => ({
          effects: [{ kind: 'external', type: 'library.token', input: { key: 'plain-value' } }],
        })),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    const personal = await invoke('library.sendPersonal', {});
    expect(!personal.ok && personal.error.code).toBe('core.request_not_allowed');
    expect({ ...(await stored(adapter)) }).toMatchObject({ effects: [], jobs: [] });
    const sealed = await invoke('library.sendSecret', {});
    expect(sealed.ok).toBe(true);
    const { effects, jobs } = await stored(adapter);
    expect([effects.length, jobs.length]).toEqual([1, 1]);
    const text = JSON.stringify(effects[0]?.input);
    expect(text).toMatch(/^\{"key":"kwv1\.[^."]+\.[^."]+\.[^."]+"\}$/);
    expect(text).not.toContain('plain-value');
  });
});
