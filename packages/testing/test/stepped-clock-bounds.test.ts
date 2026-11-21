import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, test } from 'vitest';
import { transportBoundsOf } from '../src/conformance/transport/transport-bounds-of.ts';
import { expectSteppedClockBounds, steppedClockLiveSocket } from '../src/index.ts';

describe('the live socket bounds of the runners that step a pinned clock', () => {
  test('the shared constant passes, as the host entry of a runner reads it', () => {
    expectSteppedClockBounds(transportBoundsOf(httpHost({ liveSocket: steppedClockLiveSocket })));
  });

  test.each([
    ['a runner on the defaults', {}],
    ['a runner that sets only the session check', { revalidateMs: 100_000_000 }],
    ['a runner that sets a small value', { revalidateMs: 1 }],
    [
      'a runner whose heartbeat is out of reach and session check is not',
      { heartbeatMs: 100_000_000 },
    ],
  ] as const)('%s fails', (_name, liveSocket) => {
    expect(() => expectSteppedClockBounds(transportBoundsOf(httpHost({ liveSocket })))).toThrow();
  });

  test('another setting of the live socket is no reason to fail', () => {
    expectSteppedClockBounds(
      transportBoundsOf(
        httpHost({ liveSocket: { ...steppedClockLiveSocket, maxSubscriptionsPerSocket: 2 } }),
      ),
    );
  });
});
