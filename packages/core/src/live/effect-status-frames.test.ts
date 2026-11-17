import { describe, expect, test } from 'vitest';
import { source, state } from '../../test/pending-effect-kit.ts';
import { neverCondition } from '../authorization/never-condition.ts';
import { submitterCondition } from '../effects/submitter-condition.ts';
import type { LiveFrame } from '../invoker/live-frame.ts';
import { effectStatusFrames } from './effect-status-frames.ts';

const ada = submitterCondition({ ref: { resolver: 'auth.session', principalId: 'ada' } });
const createdAt = Temporal.Instant.from('2026-11-17T10:00:00Z');

function row(id: string, owner: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    type: 'dispatch.ship',
    status: 'requested',
    createdAt,
    principalResolver: 'auth.session',
    principalId: owner,
    input: { parcel: 'parcel-secret' },
    ...extra,
  };
}

function change(
  type: 'created' | 'changed' | 'restored',
  id: string,
  owner: string,
  at?: string,
  extra: Record<string, unknown> = {},
): LiveFrame<unknown> {
  const event = { type, id, version: 1, row: row(id, owner, extra) };
  return at === undefined ? { event } : { event, state: state(at) };
}

async function collect(
  frames: readonly LiveFrame<unknown>[],
  where = ada,
): Promise<LiveFrame<unknown>[]> {
  const seen: LiveFrame<unknown>[] = [];
  for await (const frame of effectStatusFrames(source(frames), where)) seen.push(frame);
  return seen;
}

const head: LiveFrame<unknown> = { control: 'head', state: state('H1') };

describe('effectStatusFrames', () => {
  test('created, changed and restored rows of the submitter become items with their own state', async () => {
    const seen = await collect([
      change('created', 'a', 'ada'),
      head,
      change('changed', 'a', 'ada', 'S2', { status: 'succeeded' }),
      change('restored', 'b', 'ada', 'S3'),
    ]);
    expect(seen).toEqual([
      { event: { id: 'a', type: 'dispatch.ship', status: 'requested', requestedAt: createdAt } },
      head,
      {
        event: { id: 'a', type: 'dispatch.ship', status: 'succeeded', requestedAt: createdAt },
        state: state('S2'),
      },
      {
        event: { id: 'b', type: 'dispatch.ship', status: 'requested', requestedAt: createdAt },
        state: state('S3'),
      },
    ]);
    expect(JSON.stringify(seen)).not.toContain('parcel-secret');
    expect(JSON.stringify(seen)).not.toContain('principal');
  });

  test('a row of another submitter is dropped', async () => {
    const seen = await collect([
      change('created', 'a', 'bob'),
      head,
      change('changed', 'a', 'bob', 'S2'),
    ]);
    expect(seen).toEqual([head]);
  });

  test('a row without a status view is dropped', async () => {
    const seen = await collect([change('created', 'a', 'ada', undefined, { status: 'odd' }), head]);
    expect(seen).toEqual([head]);
  });

  test('a where of never drops every row', async () => {
    const seen = await collect([change('created', 'a', 'ada'), head], neverCondition);
    expect(seen).toEqual([head]);
  });

  test('removed and archived frames are dropped', async () => {
    const seen = await collect([
      { event: { type: 'removed', id: 'a', reason: 'left-view' } },
      { event: { type: 'archived', id: 'a', version: 2, row: row('a', 'ada') } },
      head,
    ]);
    expect(seen).toEqual([head]);
  });

  test('control frames pass unchanged', async () => {
    const frames: LiveFrame<unknown>[] = [
      head,
      { control: 'reset', reason: 'resync', state: state('R1') },
      { control: 'gap', missed: 3 },
    ];
    expect(await collect(frames)).toEqual(frames);
  });

  test('return reaches the inner stream', async () => {
    let returned = false;
    const stream = effectStatusFrames(
      source([change('created', 'a', 'ada'), head], () => (returned = true)),
      ada,
    );
    const iterator = stream[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.return?.();
    expect(returned).toBe(true);
  });
});
