import {
  type LoggedLine,
  pinnedTransportClock,
  recordingLogger,
  startTransportRuntime,
  streamEndingCases,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { describe, vi } from 'vitest';
import { orpcCodec } from './support/orpc-codec.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

vi.setConfig({ testTimeout: 120_000 });

const origins = ['https://app.example.test'];
const begin = Temporal.Instant.from('2026-11-12T12:00:00Z');

describe('the endings of a stream through oRPC', () => {
  streamEndingCases(orpcCodec, async (bounds) => {
    const pinned = pinnedTransportClock(begin);
    const lines: LoggedLine[] = [];
    const runtime = await startTransportRuntime({
      app: orpcConformanceApp,
      host: httpHost({
        live: { maxDurationMs: bounds.maxDurationMs, maxStreams: bounds.maxStreams },
        liveSocket: { revalidateMs: bounds.revalidateMs },
      }),
      config: { orpc: { cors: origins } },
      tenants: ['acme', 'globex', 'legacy'],
      tenantApiVersions: { legacy: orpcConformanceVersions.older },
      clock: pinned.clock,
      timers: pinned.timers,
      logger: recordingLogger(lines),
    });
    return {
      target: transportTargetOf(runtime, orpcCodec, origins, true, pinned.advance),
      clock: pinned.clock,
      lines,
      hostServes: false,
      stop: runtime.stop,
    };
  });
});
