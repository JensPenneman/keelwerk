import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  pinnedTransportClock,
  protocolCodec,
  startTransportRuntime,
  streamEndingCases,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { describe, vi } from 'vitest';
import { httpHost } from '../src/index.ts';

vi.setConfig({ testTimeout: 120_000 });

const origins = ['https://app.example.test'];
const app = defineApp({ id: 'streams', modules: [live, library, loans] });
const begin = Temporal.Instant.from('2026-11-12T12:00:00Z');

describe('the endings of a stream through the protocol', () => {
  streamEndingCases(protocolCodec, async (bounds) => {
    const pinned = pinnedTransportClock(begin);
    const runtime = await startTransportRuntime({
      app,
      host: httpHost({
        live: { maxDurationMs: bounds.maxDurationMs, maxStreams: bounds.maxStreams },
        liveSocket: { revalidateMs: bounds.revalidateMs },
      }),
      clock: pinned.clock,
      timers: pinned.timers,
    });
    return {
      target: transportTargetOf(runtime, protocolCodec, origins, true, pinned.advance),
      clock: pinned.clock,
      stop: runtime.stop,
    };
  });
});
