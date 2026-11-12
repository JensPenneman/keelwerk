import type { LiveFrame, StateToken } from '@keelwerk/core';
import { contracts, defineApp, defineModule, defineModuleBase } from '@keelwerk/core';
import { createLocalClient, startTestRuntime, testPrincipal } from '@keelwerk/testing';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { live } from '../../src/live-module.ts';
import { board } from '../hub/support/board-module.ts';
import { collectFrames } from '../support/collect-frames.ts';
import { jotter } from './support/state-module.ts';

vi.setConfig({ testTimeout: 60_000 });

const app = defineApp({ id: 'watching', modules: [live, board, jotter] });
const runtime = await startTestRuntime(app, { tenants: ['acme', 'globex'] });
afterAll(() => runtime.stop());

const writer = createLocalClient(runtime, {
  principal: testPrincipal('w', { claims: { seed: true } }),
});
const ada = createLocalClient(runtime, { principal: testPrincipal('ada') });

type Change = {
  readonly type: string;
  readonly id: string;
  readonly version?: number;
  readonly cause?: string;
  readonly reason?: string;
  readonly row?: Record<string, unknown>;
};

const items = (frames: readonly LiveFrame<unknown>[]): Change[] =>
  frames.flatMap((frame) => ('event' in frame ? [frame.event as Change] : []));

const create = (title: string, over: Record<string, unknown> = {}) =>
  writer.invoke('board.card.create', { owner: 'ada', title, ...over } as never) as Promise<{
    id: string;
  }>;

const update = (id: string, patch: Record<string, unknown>) =>
  writer.invoke('board.card.update', { id, patch } as never);

describe('the generated watch through the local client', () => {
  test('from beginning emits the current rows, then head, then changed with version and cause', async () => {
    const first = await create('one');
    const stream = collectFrames(ada.subscribe('board.card.watch', { from: 'beginning' } as never));
    try {
      await stream.ready();
      expect(stream.frames[0]).toMatchObject({
        event: { type: 'changed', id: first.id, version: 1, row: { title: 'one' } },
      });
      expect(stream.frames[1]).toMatchObject({ control: 'head' });
      await update(first.id, { title: 'two' });
      await stream.until((frames) => frames.length >= 3);
      expect(stream.frames[2]).toMatchObject({
        event: {
          type: 'changed',
          id: first.id,
          version: 2,
          cause: 'changed',
          row: { title: 'two' },
        },
        state: expect.stringMatching(/^v2\./),
      });
    } finally {
      await stream.stop();
    }
  });

  test('removed carries a reason and no row', async () => {
    const card = await create('leaving');
    const stream = collectFrames(ada.subscribe('board.card.watch', { from: 'beginning' } as never));
    try {
      await stream.ready();
      await update(card.id, { shown: false });
      await stream.until((frames) => items(frames).some((item) => item.type === 'removed'));
      const removed = items(stream.frames).find((item) => item.type === 'removed');
      expect(removed).toMatchObject({ type: 'removed', id: card.id, reason: 'left-view' });
      expect(removed).not.toHaveProperty('row');
      expect(removed).not.toHaveProperty('version');
    } finally {
      await stream.stop();
    }
  });

  test('ids, filter, fields and includeArchived each narrow the stream', async () => {
    const owner = `owner-${crypto.randomUUID().slice(0, 8)}`;
    const mine = createLocalClient(runtime, { principal: testPrincipal(owner) });
    const a = await create('alpha', { owner });
    const b = await create('beta', { owner });
    const c = await create('gamma', { owner });
    await writer.invoke('board.card.archive', { id: c.id } as never);
    const read = async (input: Record<string, unknown>): Promise<Change[]> => {
      const stream = collectFrames(
        mine.subscribe('board.card.watch', { from: 'beginning', ...input } as never),
      );
      try {
        await stream.ready();
        return items(stream.frames);
      } finally {
        await stream.stop();
      }
    };
    expect((await read({})).map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
    expect((await read({ ids: [a.id] })).map((item) => item.id)).toEqual([a.id]);
    expect((await read({ filter: { title: 'beta' } })).map((item) => item.id)).toEqual([b.id]);
    const selected = await read({ ids: [a.id], fields: ['title'] });
    expect(selected[0]?.row).toMatchObject({ title: 'alpha' });
    expect(selected[0]?.row).not.toHaveProperty('owner');
    expect(selected[0]?.row).not.toHaveProperty('shown');
    const withArchived = await read({ includeArchived: true });
    expect(withArchived.map((item) => item.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  test('an id that is no id of the entity is a validation error, not an empty stream', async () => {
    const attempt = (ids: unknown) =>
      ada
        .subscribe('board.card.watch', { ids } as never)
        [Symbol.asyncIterator]()
        .next();
    await expect(attempt(['not-an-id'])).rejects.toMatchObject({ kind: 'validation' });
    await expect(attempt(['x'.repeat(1_000_000)])).rejects.toMatchObject({ kind: 'validation' });
    await expect(attempt(crypto.randomUUID())).rejects.toMatchObject({ kind: 'validation' });
  });

  test('resuming with after replays from the token', async () => {
    const card = await create('resumable');
    const stream = collectFrames(ada.subscribe('board.card.watch', {} as never));
    let token: StateToken;
    try {
      await stream.ready();
      const head = stream.frames.find((frame) => 'control' in frame);
      token = (head as { state: StateToken }).state;
    } finally {
      await stream.stop();
    }
    await update(card.id, { title: 'changed while away' });
    const resumed = collectFrames(ada.subscribe('board.card.watch', {} as never, { after: token }));
    try {
      await resumed.ready();
      expect(resumed.frames[0]).toMatchObject({
        event: { type: 'changed', id: card.id, row: { title: 'changed while away' } },
      });
      expect(resumed.frames.at(-1)).toMatchObject({ control: 'head' });
    } finally {
      await resumed.stop();
    }
  });

  test('a history state entity is watched through its transient records', async () => {
    const made = (await writer.invoke('jotter.note.create', {
      owner: 'ada',
      text: 'first',
    } as never)) as { id: string };
    const stream = collectFrames(
      ada.subscribe('jotter.note.watch', { from: 'beginning' } as never),
    );
    try {
      await stream.ready();
      expect(stream.frames[0]).toMatchObject({
        event: { type: 'changed', id: made.id, version: 1, row: { text: 'first' } },
      });
      expect(stream.frames[1]).toMatchObject({ control: 'head' });
      await writer.invoke('jotter.note.update', {
        id: made.id,
        patch: { text: 'second' },
      } as never);
      await stream.until((frames) => items(frames).length >= 2);
      expect(items(stream.frames)[1]).toMatchObject({
        type: 'changed',
        id: made.id,
        version: 2,
        cause: 'changed',
        row: { text: 'second' },
      });
      await writer.invoke('jotter.note.archive', { id: made.id } as never);
      await stream.until((frames) => items(frames).some((item) => item.type === 'archived'));
      const archived = items(stream.frames).find((item) => item.type === 'archived');
      expect(archived).toMatchObject({ type: 'archived', id: made.id, version: 3 });
    } finally {
      await stream.stop();
    }
  });

  test('an app without a live hub rejects subscribe with core.live_unavailable', async () => {
    const stub = defineModule(
      defineModuleBase({
        id: 'live',
        version: '0.1.0',
        provides: [contracts.live],
        generates: ['watch'],
      }),
      {},
    );
    const bare = await startTestRuntime(defineApp({ id: 'no-hub', modules: [stub, board] }), {
      tenants: ['acme'],
    });
    try {
      const client = createLocalClient(bare, { principal: testPrincipal('ada') });
      const stream = collectFrames(client.subscribe('board.card.watch', {} as never));
      await expect(stream.until(() => false, 5000)).rejects.toThrow(/core.live_unavailable/);
      expect(stream.failure()).toMatchObject({
        kind: 'unavailable',
        code: 'core.live_unavailable',
      });
    } finally {
      await bare.stop();
    }
  });
});
