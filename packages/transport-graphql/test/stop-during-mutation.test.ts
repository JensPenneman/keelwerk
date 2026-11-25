import type { Clock, Telemetry } from '@keelwerk/core';
import { type LoggedLine, pinnedLiveTimers, recordingLogger } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, test, vi } from 'vitest';
import { createGraphqlAdapter } from '../src/create-graphql-adapter.ts';
import {
  graphqlDefaultConfig,
  graphqlInvoker,
  transportSurface,
  uuidOf,
} from './support/graphql-kit.ts';

const surface = transportSurface();
const instrument = { add() {}, record() {} };
/** A tracer and a meter that record nothing, as much of them as the host uses. */
const quietTelemetry = {
  tracer: {
    startSpan: () => ({ updateName() {}, setAttributes() {}, setStatus() {}, end() {} }),
  },
  meter: {
    createHistogram: () => instrument,
    createUpDownCounter: () => instrument,
    createCounter: () => instrument,
  },
} as unknown as Telemetry;
const mutation =
  'mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z" }) { __typename ... on LoansLendSuccess { result { loanId } } } }';

/** The real host with the GraphQL adapter mounted, over a fake invoker whose commands wait for `gate`. */
async function hosted(gate: Promise<void>, entered: () => void) {
  const lines: LoggedLine[] = [];
  const clock: Clock = { now: () => Temporal.Instant.from('2026-11-19T10:00:00Z') };
  const { invoker, calls } = graphqlInvoker(async () => {
    entered();
    await gate;
    return { ok: true, value: { loanId: uuidOf(5) } };
  });
  const log = recordingLogger(lines);
  const host = httpHost({ live: { maxDurationMs: 86_400_000 } }).create({
    surface: () => surface,
    log,
    invoker,
    telemetry: quietTelemetry,
    clock,
    timers: pinnedLiveTimers(clock),
  });
  await createGraphqlAdapter().mount({
    app: surface.app,
    deploymentId: '0198a1e0-0000-7000-8000-00000000d001',
    surface,
    invoker,
    host,
    config: () => graphqlDefaultConfig,
    telemetry: {} as unknown as Telemetry,
    log,
  });
  return { host, calls, lines };
}

describe('a mutation that asks for an event stream, when the host stops while it runs', () => {
  test.each(['text/event-stream', 'text/event-stream, application/json;q=0.5'])(
    'still delivers its result (Accept: %s)',
    async (accept) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = false;
      const { host, calls, lines } = await hosted(gate, () => {
        entered = true;
      });
      const asked = host.fetch(
        new Request('https://portal.example/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept },
          body: JSON.stringify({ query: mutation }),
        }),
        { remoteAddress: '198.18.0.5' },
      );
      await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000 });
      const stopping = host.stop(5_000);
      release();
      const response = await asked;
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('LoansLendSuccess');
      expect(response.headers.get('content-type')).not.toMatch(/text\/event-stream/);
      expect(JSON.parse(text)).toMatchObject({
        data: { loansLend: { __typename: 'LoansLendSuccess' } },
      });
      await stopping;
      expect(calls).toHaveLength(1);
      expect(lines.filter((line) => line.message === 'stream ended by the host')).toEqual([]);
    },
    120_000,
  );
});
