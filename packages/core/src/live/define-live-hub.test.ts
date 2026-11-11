import { describe, expect, test } from 'vitest';
import { liveHubFillerOf } from '../runtime/live-hub-filler-of.ts';
import { defineLiveHub } from './define-live-hub.ts';
import type { RuntimeLiveHub } from './runtime-live-hub.ts';

const hub = { close: () => Promise.resolve() } as unknown as RuntimeLiveHub;

function registryWith(fill: unknown, bound = false) {
  return {
    fills: new Map([['core.liveHub', [{ point: 'core.liveHub', module: 'live', bound, fill }]]]),
  } as never;
}

describe('defineLiveHub', () => {
  test('is a frozen value that holds no state and opens a hub with the services it is given', () => {
    const services = { clock: { now: () => Temporal.Now.instant() }, log: {} as never };
    const seen: unknown[] = [];
    const filler = defineLiveHub((given) => {
      seen.push(given);
      return hub;
    });
    expect(Object.isFrozen(filler)).toBe(true);
    expect(filler.kind).toBe('liveHubFiller');
    expect(filler.open(services)).toBe(hub);
    expect(seen).toEqual([services]);
  });

  test('its own members refuse and say who opens the hub', async () => {
    const filler = defineLiveHub(() => hub);
    for (const iterable of [
      filler.entity({} as never, 'a.b', {}),
      filler.pokes({} as never),
      filler.stream({} as never, 's', 'k', { from: 'now' }),
      filler.topic({} as never, 't', 'k'),
    ]) {
      await expect(iterable[Symbol.asyncIterator]().next()).rejects.toMatchObject({
        kind: 'internal',
        code: 'core.internal',
        message: 'The live hub is opened by the runtime; subscribe through the invoker.',
      });
    }
  });
});

describe('liveHubFillerOf', () => {
  test('answers the first fill of the point, and nothing for an app without one', () => {
    const filler = defineLiveHub(() => hub);
    expect(liveHubFillerOf(registryWith(filler))).toBe(filler);
    expect(liveHubFillerOf({ fills: new Map() } as never)).toBeUndefined();
  });

  test('a bound fill, or a value defineLiveHub did not make, is internal', () => {
    const message = 'The liveHub point takes a value made by defineLiveHub.';
    const filler = defineLiveHub(() => hub);
    expect(() => liveHubFillerOf(registryWith(filler, true))).toThrow(
      expect.objectContaining({ kind: 'internal', message }),
    );
    expect(() => liveHubFillerOf(registryWith(hub))).toThrow(
      expect.objectContaining({ kind: 'internal', message }),
    );
    // A value with an `open` that is not the filler's own kind is no filler either.
    expect(() => liveHubFillerOf(registryWith({ open: () => hub }))).toThrow(
      expect.objectContaining({ kind: 'internal', message }),
    );
    expect(() => liveHubFillerOf(registryWith({ kind: 'liveHubFiller', open: 1 }))).toThrow(
      expect.objectContaining({ kind: 'internal', message }),
    );
  });
});
