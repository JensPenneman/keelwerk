import { readFileSync } from 'node:fs';
import { deriveEffectId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  command,
  effectsKit,
  eventsOf,
  externalEffect,
  reaction,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { clock, tenant } from './support/run-read-kit.ts';

interface Writes {
  readonly write: {
    readonly library: { readonly book: { create(values: Record<string, unknown>): unknown } };
  };
}

/** A value as JSON text would carry it: instants and bigints as strings, the random ids of events named by `ids`. */
function plain(value: unknown, ids: ReadonlyMap<string, string> = new Map()): unknown {
  const text = JSON.stringify(value, (_key, member: unknown) => {
    if (typeof member === 'bigint') return `${member}n`;
    if (typeof member === 'string') return ids.get(member) ?? member;
    return member;
  });
  return JSON.parse(text);
}

/** Compares `value` with the committed file `golden/<name>.json`. */
function golden(name: string, value: unknown): void {
  const path = new URL(`./golden/${name}.json`, import.meta.url);
  expect(value).toEqual(JSON.parse(readFileSync(path, 'utf8')));
}

const deadline = Temporal.Instant.from('2026-02-01T00:00:00Z');

describe('the stored formats of effects (F-12)', () => {
  test('the core.effect row, its created event and the effect job', async () => {
    const declared = externalEffect('notify', async () => ({ ok: true }), {
      queue: 'mail',
      capability: ['smtp-out'],
      retry: { delays: ['30s'] },
      timeout: '30s',
    });
    const registry = registryWith({
      effects: [declared.effect],
      executors: [declared.executor],
      actions: [
        command('send', (_i: unknown, ctx: Writes) => ({
          events: [ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' })],
          effects: [
            {
              kind: 'external',
              type: 'library.notify',
              input: { to: 'ada@example.org' },
              continueWith: 'library.after',
              with: { id: 'x' },
              key: 'k-1',
              deadline,
            },
          ],
        })),
        command('after', () => []),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.send', {}, { commandId: 'c1' });
    const { effects, jobs, books } = await stored(adapter, ['mail']);
    const [bookEvent] = await eventsOf(adapter, 'library.book', String(books[0]?.id));
    const [created] = await eventsOf(adapter, 'core.effect', deriveEffectId(tenant, 'c1', 0));
    const ids = new Map([[String(bookEvent?.eventId), '<book event id>']]);
    golden('effect-row', plain(effects[0], ids));
    golden('effect-created-event-data', plain(created?.data, ids));
    golden('effect-job', plain(jobs[0]));
  });

  test('the job of an enqueue effect', async () => {
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
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.launch', {}, { commandId: 'c1' });
    golden('command-job', plain((await stored(adapter)).jobs[0]));
  });

  test('the job of a timer', async () => {
    const registry = registryWith({
      actions: [
        command('launch', () => ({
          effects: [
            {
              kind: 'setTimer',
              type: 'setTimer',
              key: 'offline:1',
              action: 'library.later',
              input: { n: 3 },
              at: clock.now(),
            },
          ],
        })),
        command('later', () => []),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.launch', {}, { commandId: 'c1' });
    const ids = new Map([
      [`kernel:timer:${deriveEffectId(tenant, 'c1', 0)}`, 'kernel:timer:<effect id>'],
    ]);
    golden('timer-job', plain((await stored(adapter)).jobs[0], ids));
  });

  test('the job of an accepted command and its receipt', async () => {
    const registry = registryWith({
      actions: [command('slow', () => [], { execution: 'async', idempotencyWindowMs: 3_600_000 })],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.slow', { n: 1 }, { commandId: 'a1' });
    golden('accepted-command-job', plain((await stored(adapter)).jobs[0]));
  });

  test('a job a reaction causes names the actor of the event, not the module principal', async () => {
    const registry = registryWith({
      actions: [
        command('add', (_i: unknown, ctx: Writes) => [
          ctx.write.library.book.create({ title: 'T', isbn: 't-1', addedBy: 'ada' }),
        ]),
        command('later', () => []),
      ],
      reactions: [
        reaction('library.arms', 'library.book.created', () => ({
          effects: [
            {
              kind: 'setTimer',
              type: 'setTimer',
              key: 'r:1',
              action: 'library.later',
              input: {},
              at: clock.now(),
            },
          ],
        })),
      ],
    });
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.add', {}, { commandId: 'c1' });
    const { jobs } = await stored(adapter);
    expect(jobs[0]?.principal).toEqual({ resolver: 'core.module', principalId: 'library.system' });
    expect(jobs[0]?.causation.actor).toEqual({ kind: 'user', id: 'ada', via: 'test' });
  });
});
