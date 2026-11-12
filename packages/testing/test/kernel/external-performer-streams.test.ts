import { renderTypeId } from '@keelwerk/core';
import { describe, expect, test, vi } from 'vitest';
import { dataOfStream } from './support/data-of-stream.ts';
import { dispatchRuntime } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

describe.each(['memory', 'pglite'] as const)('external performer streams on %s', (adapter) => {
  const { start } = dispatchRuntime(adapter);

  test('no rule reads an effect over HTTP: get and watch are forbidden for its submitter and for others', async () => {
    const { post, rawWatch, sent } = await start();
    const { id } = await sent({ parcel: 'parcel-9f3c1d' }, { as: 'ada' });
    const wire = renderTypeId('eff', id);
    for (const as of ['ada', 'bob']) {
      const got = await post('core.effect.get', { ids: [wire] }, { as });
      expect(got.status).toBe(403);
      expect(got.json).toMatchObject({ error: { kind: 'forbidden', code: 'core.forbidden' } });
      expect(got.text).not.toContain('parcel-9f3c1d');
      const watched = await rawWatch(
        'core.effect.watch',
        { ids: [wire], from: 'beginning' },
        { as },
      );
      expect(watched.text).toContain('core.forbidden');
      expect(watched.text).not.toContain('event: data');
      expect(watched.text).not.toContain('parcel-9f3c1d');
    }
  });

  test('a performer settles with the id it listed', async () => {
    const { post, rawWatch, rows, runtime, sent } = await start();
    const { id } = await sent({ parcel: 'p-listed' });
    const listed = await rawWatch('dispatch.pending', { depot: 'north' }, { as: 'courier' });
    const frame = dataOfStream(listed.text)[0] as { id: string; parcel: string };
    expect(frame.parcel).toBe('p-listed');
    expect(frame.id).toMatch(/^eff_/);
    expect(frame.id).toBe(renderTypeId('eff', id));
    const refused = await post('dispatch.report', { effectId: id, ok: true, tracking: 'T-0' });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ error: { kind: 'validation' } });
    const delivery = await post('dispatch.report', {
      effectId: renderTypeId('dlv', crypto.randomUUID()),
      ok: true,
      tracking: 'T-0',
    });
    expect(delivery.status).toBe(422);
    expect(delivery.json).toMatchObject({ error: { kind: 'validation' } });
    expect((await rows('core.effect')).find((row) => row.id === id)?.status).toBe('requested');
    const settled = await post('dispatch.report', {
      effectId: frame.id,
      ok: true,
      tracking: 'T-1',
    });
    expect(settled.status).toBe(200);
    await runtime.drainJobs();
    expect((await rows('core.effect')).find((row) => row.id === id)?.status).toBe('succeeded');
    expect(await rows('dispatch.delivery')).toEqual([
      expect.objectContaining({ parcel: 'p-listed', tracking: 'T-1' }),
    ]);
  });

  test('a performer that drops after the first of several pending effects is served all of them again', async () => {
    const { follow, sent } = await start();
    await sent({ parcel: 'p-0' });
    const opening = await follow('north');
    let token: string | undefined;
    try {
      await opening.next();
      const frames = await opening.until((frame) => frame.event === 'head');
      token = frames.find((frame) => frame.event === 'head')?.id;
    } finally {
      await opening.close();
    }
    expect(token).toBeTruthy();
    const ids = [
      (await sent({ parcel: 'p-1' })).id,
      (await sent({ parcel: 'p-2' })).id,
      (await sent({ parcel: 'p-3' })).id,
    ].map((id) => renderTypeId('eff', id));
    const dropping = await follow('north', { lastEventId: token ?? '' });
    let resumeFrom: string | undefined;
    try {
      await dropping.next();
      const first = await dropping.next();
      expect(first?.event).toBe('data');
      resumeFrom = first?.id;
    } finally {
      await dropping.close();
    }
    const again = await follow('north', { lastEventId: resumeFrom ?? token ?? '' });
    try {
      await again.next();
      const frames = await again.until((frame) => frame.event === 'head');
      const seen = frames
        .filter((frame) => frame.event === 'data')
        .map((frame) => (frame.data as { id: string }).id);
      expect(seen.sort()).toEqual([...ids].sort());
    } finally {
      await again.close();
    }
  });

  test('a token of one depot is no token of another: the stream starts again instead of skipping', async () => {
    const { follow, sent } = await start();
    const south = await sent({ parcel: 'p-south', depot: 'south' });
    await sent({ parcel: 'p-north', depot: 'north' });
    const north = await follow('north');
    let token: string | undefined;
    try {
      await north.next();
      const frames = await north.until((frame) => frame.event === 'head');
      token = frames.find((frame) => frame.event === 'head')?.id;
    } finally {
      await north.close();
    }
    const wrong = await follow('south', { lastEventId: token ?? '' });
    try {
      await wrong.next();
      const frames = await wrong.until(
        (frame) => frame.event === 'reset' || frame.event === 'head',
      );
      expect(frames.at(-1)).toMatchObject({ event: 'reset', data: { reason: 'resync' } });
    } finally {
      await wrong.close();
    }
    const fresh = await follow('south');
    try {
      await fresh.next();
      const frames = await fresh.until((frame) => frame.event === 'head');
      expect(frames.filter((frame) => frame.event === 'data').map((frame) => frame.data)).toEqual([
        expect.objectContaining({ id: renderTypeId('eff', south.id) }),
      ]);
    } finally {
      await fresh.close();
    }
  });
});
