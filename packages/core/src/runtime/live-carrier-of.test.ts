import { describe, expect, test } from 'vitest';
import type { LiveCarrier } from '../live/live-carrier.ts';
import type { Registry } from '../registry/registry.ts';
import { liveCarrierOf } from './live-carrier-of.ts';

const carrier = (name: string): LiveCarrier => ({ name, serve: async () => undefined });

function registryOf(fills: readonly { fill: unknown; bound?: boolean }[]): Registry {
  return {
    fills: new Map([
      [
        'core.liveCarriers',
        fills.map((entry) => ({
          point: 'core.liveCarriers',
          module: 'live',
          bound: entry.bound ?? false,
          fill: entry.fill,
        })),
      ],
    ]),
  } as unknown as Registry;
}

describe('liveCarrierOf', () => {
  test('finds a fill by name', () => {
    const sse = carrier('sse');
    expect(liveCarrierOf(registryOf([{ fill: carrier('websocket') }, { fill: sse }]), 'sse')).toBe(
      sse,
    );
  });

  test('answers undefined without one', () => {
    expect(liveCarrierOf(registryOf([{ fill: carrier('websocket') }]), 'sse')).toBeUndefined();
    expect(liveCarrierOf({ fills: new Map() } as unknown as Registry, 'sse')).toBeUndefined();
  });

  test('skips a bound fill and a fill without serve', () => {
    expect(
      liveCarrierOf(
        registryOf([{ fill: carrier('sse'), bound: true }, { fill: { name: 'sse' } }]),
        'sse',
      ),
    ).toBeUndefined();
  });
});
