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
import { graphqlCodec } from './support/graphql-codec.ts';
import {
  graphqlConformanceApp,
  graphqlConformanceVersions,
} from './support/graphql-conformance-app.ts';

vi.setConfig({ testTimeout: 120_000 });

const origins = ['https://app.example.test'];
const config = { graphql: { cors: origins, websocket: true } };
const begin = Temporal.Instant.from('2026-11-12T12:00:00Z');

describe('the endings of a stream through GraphQL over SSE', () => {
  streamEndingCases(graphqlCodec, async (bounds) => {
    const pinned = pinnedTransportClock(begin);
    const lines: LoggedLine[] = [];
    const runtime = await startTransportRuntime({
      app: graphqlConformanceApp,
      host: httpHost({
        live: { maxDurationMs: bounds.maxDurationMs, maxStreams: bounds.maxStreams },
        liveSocket: { revalidateMs: bounds.revalidateMs },
      }),
      config,
      tenants: ['acme', 'globex', 'legacy'],
      tenantApiVersions: { legacy: graphqlConformanceVersions.older },
      clock: pinned.clock,
      timers: pinned.timers,
      logger: recordingLogger(lines),
    });
    return {
      target: transportTargetOf(runtime, graphqlCodec, origins, true, pinned.advance),
      clock: pinned.clock,
      lines,
      hostServes: false,
      stop: runtime.stop,
    };
  });
});
