import type { InfrastructureEntry } from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, it } from 'vitest';
import { transportBoundsOf } from '../src/conformance/transport/transport-bounds-of.ts';

describe('transportBoundsOf', () => {
  it('reads the caps of an httpHost entry; an entry without them gets 20 and 100', () => {
    expect(
      transportBoundsOf(
        httpHost({
          live: { maxStreamsPerPrincipal: 5 },
          liveSocket: { maxSubscriptionsPerSocket: 3 },
        }),
      ),
    ).toEqual({ maxStreamsPerPrincipal: 5, maxSubscriptionsPerSocket: 3 });
    expect(transportBoundsOf(httpHost())).toEqual({
      maxStreamsPerPrincipal: 20,
      maxSubscriptionsPerSocket: 100,
    });
    const bare: InfrastructureEntry = { kind: 'httpHost', provides: [] };
    expect(transportBoundsOf(bare)).toEqual({
      maxStreamsPerPrincipal: 20,
      maxSubscriptionsPerSocket: 100,
    });
  });
});
