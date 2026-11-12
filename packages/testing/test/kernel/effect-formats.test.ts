import { readFileSync } from 'node:fs';
import type { Registry } from '@keelwerk/core';
import { deriveEffectId, entityBehavioursOf } from '@keelwerk/core';
import { seedRows } from '@keelwerk/core/replay';
import { describe, expect, test } from 'vitest';
import { conformanceApp } from '../../src/fixtures/index.ts';
import { startTestRuntime } from '../../src/harness/start-test-runtime.ts';
import { testCarrier } from '../../src/harness/test-carrier.ts';
import { testOperator } from '../../src/harness/test-operator.ts';
import { testPrincipal } from '../../src/harness/test-principal.ts';
import { tenantAddress } from '../../src/replay/tenant-address.ts';
import {
  command,
  effectsKit,
  eventsOf,
  externalEffect,
  reaction,
  registryWith,
  stored,
} from './support/effects-kit.ts';
import { clock, tenant, userOf } from './support/run-read-kit.ts';

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

/** The kit's registry served with a resolver whose principal carries a reference, as a deployed resolver's does. */
function withReferencedPrincipal(registry: Registry): Registry {
  const resolver = {
    id: 'test.principal',
    describe: () => ({ scheme: 'bearer' }),
    // biome-ignore lint/correctness/useYield: the resolver loads nothing
    *resolve() {
      return {
        principal: { ...userOf('ada'), ref: { resolver: 'test.principal', principalId: 'ada' } },
      };
    },
  };
  return {
    ...registry,
    fills: new Map([
      ...registry.fills,
      [
        'core.principalResolvers',
        [{ point: 'core.principalResolvers', module: 'library', bound: false, fill: resolver }],
      ],
    ]),
  };
}

describe('the stored formats of effects (F-12)', () => {
  test('the core.effect row, its created event and the effect job', async () => {
    const declared = externalEffect('notify', async () => ({ ok: true }), {
      queue: 'mail',
      capability: ['smtp-out'],
      retry: { delays: ['30s'] },
      timeout: '30s',
    });
    const registry = withReferencedPrincipal(
      registryWith({
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
      }),
    );
    const { adapter, invoke } = effectsKit(registry);
    await invoke('library.send', {}, { commandId: 'c1' });
    const { effects, jobs, books } = await stored(adapter, ['mail']);
    const [bookEvent] = await eventsOf(adapter, 'library.book', String(books[0]?.id));
    const [created] = await eventsOf(adapter, 'core.effect', deriveEffectId(tenant, 'c1', 0));
    const ids = new Map([[String(bookEvent?.eventId), '<book event id>']]);
    golden('effect-row-submitter', plain(effects[0], ids));
    golden('effect-created-event-data-submitter', plain(created?.data, ids));
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

describe.each(['memory', 'pglite'] as const)(
  'a requested record without a submitter on %s',
  (adapter) => {
    test('a requested record without a submitter folds and reads', async () => {
      const runtime = await startTestRuntime(conformanceApp, { adapter, operators: true });
      try {
        const { registry, modules } = conformanceApp;
        const address = tenantAddress(runtime);
        const row = JSON.parse(
          readFileSync(new URL('./golden/effect-row.json', import.meta.url), 'utf8'),
        ) as { id: string };
        const { values } = JSON.parse(
          readFileSync(new URL('./golden/effect-created-event-data.json', import.meta.url), 'utf8'),
        ) as { values: Record<string, unknown> };
        await runtime.sealed.unit(address.namespace, address.scope, (unit) =>
          seedRows({
            unit,
            registry,
            behaviours: entityBehavioursOf(modules),
            rows: {
              'core.effect': [{ id: row.id, ...values, deadline }],
            },
            now: Temporal.Instant.from('2026-01-01T00:00:00Z'),
          }),
        );
        const descriptor = registry.entities.get('core.effect')?.descriptor;
        if (descriptor === undefined) throw new Error('no core.effect');
        const [folded] = await runtime.sealed.unit(
          address.namespace,
          address.scope,
          async (unit) => (await unit.rows.find(descriptor, {})).rows,
        );
        const [created] = await runtime.sealed.unit(address.namespace, address.scope, (unit) =>
          unit.events.readStream({ type: 'core.effect', id: row.id }),
        );
        golden('effect-created-event-data', plain(created?.data));
        golden('effect-row', plain(folded));
        const get = async (principal: ReturnType<typeof testPrincipal>) =>
          await runtime.invoker.invoke({
            action: 'core.effect.get',
            input: { ids: [row.id] },
            carrier: testCarrier(address.tenant, principal),
            requestId: crypto.randomUUID(),
            signal: new AbortController().signal,
            commandId: crypto.randomUUID(),
          });
        // No rule of the core module reads an effect: neither a signed-in user nor an operator reads the record through the API.
        for (const principal of [testPrincipal('ada'), testOperator('olive')]) {
          expect(await get(principal)).toMatchObject({
            ok: false,
            error: { kind: 'forbidden', code: 'core.forbidden', rules: [] },
          });
        }
      } finally {
        await runtime.stop();
      }
    });
  },
);

describe('the API surface of core.effect', () => {
  test('the API surface of core.effect keeps the released members and hides the submitter reference', () => {
    const surface = JSON.parse(
      readFileSync(
        new URL(
          '../../src/fixtures/apps/conformance/generated/api-surface/conformance/2026-11-04.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      actions: {
        ref: string;
        output?: { fields?: { list?: { item?: { fields?: Record<string, unknown> } } } };
      }[];
    };
    const get = surface.actions.find((action) => action.ref === 'core.effect.get');
    expect(Object.keys(get?.output?.fields?.list?.item?.fields ?? {}).sort()).toEqual(
      [
        'id',
        'version',
        'createdAt',
        'updatedAt',
        'archivedAt',
        'type',
        'commandId',
        'status',
        'attempts',
        'performer',
        'input',
        'eventIds',
        'continuation',
        'continuationWith',
        'key',
        'runAt',
        'deadline',
        'output',
        'error',
        'outputDigest',
        'settledAt',
      ].sort(),
    );
  });
});
