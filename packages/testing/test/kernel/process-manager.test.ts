import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineProcess,
  field,
  processStreamRef,
  shape,
} from '@keelwerk/core';
import { afterAll, describe, expect, test } from 'vitest';
import { bootReactions, relayOwner } from './support/reactions-kit.ts';

const kit = await bootReactions();
afterAll(() => kit.stop());
const { runtime } = kit;

const tallyRows = async () =>
  (await kit.rows('acme', 'relay.echo')).filter((row) => row.reaction === 'relay.tally');
const streamOf = (tenant: 'acme' | 'globex') =>
  processStreamRef(kit.scopeOf(tenant), 'relay.tally', relayOwner);

describe('process managers', () => {
  test('the state folds over two events, and the second job sees the first', async () => {
    expect((await kit.send('acme', { channel: 'p', contact: 'ada@example.com' })).ok).toBe(true);
    await kit.settle();
    expect((await kit.send('acme', { channel: 'p', contact: 'bob@example.com' })).ok).toBe(true);
    await kit.settle();
    const rows = await tallyRows();
    // The first decision folded nothing; the second folded the first event's note (15 characters).
    expect(rows.map((row) => [row.count, row.seenText])).toEqual([
      [0, ''],
      [1, '15'],
    ]);
    // Another tenant's instance of the same key has a stream of its own.
    expect(await kit.rows('globex', 'relay.echo')).toEqual([]);
  });

  test('the stream is chained, and its personal member is sealed under the instance subject', async () => {
    const stream = streamOf('acme');
    const stored = await runtime.adapter.unit(
      runtime.namespace,
      kit.scopeOf('acme'),
      (unit) => unit.events.readStream(stream),
      { readOnly: true },
    );
    expect(stored.map((event) => [event.type, event.version])).toEqual([
      ['relay.tally.noted', 1],
      ['relay.tally.noted', 2],
    ]);
    expect(stored[0]?.prevHash).toBeNull();
    expect(stored[1]?.prevHash).toBe(stored[0]?.hash);
    expect(stored.every((event) => event.hash !== null && !event.transient)).toBe(true);
    expect(stored[0]?.data).toMatchObject({ n: 1, note: { $kwe: 1 } });
    expect(JSON.stringify(stored.map((event) => event.data))).not.toContain('example.com');
    // The fold opens the member: the second decision of the first test saw the first note's 15 characters.
  });

  test('a process that reacts to an event of a backend entity is refused at compose', () => {
    const setting = defineEntity({
      prefix: 'stg',
      tenancy: 'backend',
      fields: { text: field.string() },
    });
    const base = defineModuleBase({ id: 'cfg', version: '0.1.0', entities: { setting } });
    const watcher = defineProcess(
      base as never,
      {
        on: ['cfg.setting.created'],
        key: () => 'k',
        events: { seen: shape({ n: field.integer() }) },
        initial: 0,
        evolve: (state: number) => state,
        react: () => undefined,
      } as never,
    );
    const module = defineModule(base, { reactions: { watcher } } as never);
    expect(() => defineApp({ id: 'cfgapp', modules: [module] as never })).toThrow(/processTenancy/);
  });
});
