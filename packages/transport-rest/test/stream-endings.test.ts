import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  type LoggedLine,
  pinnedTransportClock,
  recordingLogger,
  startTransportRuntime,
  streamEndingCases,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { describe, vi } from 'vitest';
import { rest } from '../src/index.ts';
import { restCodec } from './support/rest-codec.ts';

vi.setConfig({ testTimeout: 120_000 });

const origins = ['https://app.example.test'];
const app = defineApp({ id: 'streams', modules: [live, library, loans, rest] });
const begin = Temporal.Instant.from('2026-11-12T12:00:00Z');

describe('the endings of a stream through REST', () => {
  streamEndingCases(restCodec, async (bounds) => {
    const pinned = pinnedTransportClock(begin);
    const lines: LoggedLine[] = [];
    const runtime = await startTransportRuntime({
      app: app,
      host: httpHost({
        live: { maxDurationMs: bounds.maxDurationMs, maxStreams: bounds.maxStreams },
        liveSocket: { revalidateMs: bounds.revalidateMs },
      }),
      config: { rest: { docs: false, cors: origins } },
      clock: pinned.clock,
      timers: pinned.timers,
      logger: recordingLogger(lines),
    });
    return {
      target: transportTargetOf(runtime, restCodec, origins, true, pinned.advance),
      clock: pinned.clock,
      lines,
      hostServes: true,
      stop: runtime.stop,
    };
  });
});
