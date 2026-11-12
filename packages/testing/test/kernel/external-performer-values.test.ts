import { describe, expect, test, vi } from 'vitest';
import { dataOfStream } from './support/data-of-stream.ts';
import { dispatchRuntime } from './support/dispatch-runtime.ts';

vi.setConfig({ testTimeout: 90_000, hookTimeout: 120_000 });

/** An effect that every `by` admits, and one that none admits. */
const matching = {
  at: Temporal.Instant.from('2026-11-12T10:00:00Z'),
  n: 5n,
  raw: new Uint8Array([1, 2]),
  tags: new Set(['a', 'b']),
};
const other = {
  at: Temporal.Instant.from('2025-01-01T00:00:00Z'),
  n: 4n,
  raw: new Uint8Array([3]),
  tags: new Set(['z']),
};

describe.each(['memory', 'pglite'] as const)(
  'pending effects with domain members on %s',
  (adapter) => {
    const { start } = dispatchRuntime(adapter);

    test.each(['at', 'n', 'raw', 'tags'] as const)(
      'a where over %s admits the matching effect and refuses the other, and the frame carries the wire form',
      async (by) => {
        const { call, rawWatch } = await start();
        const admitted = await call('dispatch.stampIt', matching);
        const refused = await call('dispatch.stampIt', other);
        expect(admitted).toMatchObject({ ok: true });
        expect(refused).toMatchObject({ ok: true });
        const watched = await rawWatch('dispatch.stamped', { by }, { as: 'courier' });
        expect(watched.status).toBe(200);
        expect(watched.text).not.toContain('event: error');
        const frames = dataOfStream(watched.text);
        expect(frames).toHaveLength(1);
        const [frame] = frames;
        expect(frame).toMatchObject({
          at: '2026-11-12T10:00:00.000Z',
          n: '5',
          raw: 'AQI',
          tags: ['a', 'b'],
        });
        expect(String(frame?.id)).toMatch(/^eff_/);
      },
    );
  },
);
