import type { Clock, TransportAdapter } from '@keelwerk/core';
import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { expect, test } from 'vitest';
import { transportWithRest } from './support/transport-app.ts';

// The runtime hands its clock to the HTTP host and to every transport mount; without it a login's
// cookie would count its Max-Age from the system clock, not from the invocation's (section 7.9).
test('the runtime passes its clock to the HTTP host and to the transport mounts', async () => {
  const clock: Clock = { now: () => Temporal.Instant.from('2020-01-01T00:00:00Z') };
  const seen: { host: Clock | undefined; mounts: (Clock | undefined)[] } = {
    host: undefined,
    mounts: [],
  };
  const entry = httpHost();
  const host = {
    ...entry,
    create: (deps: Parameters<typeof entry.create>[0]) => {
      seen.host = deps.clock;
      return entry.create(deps);
    },
  };
  const fills = transportWithRest.registry.fills;
  const spied = {
    ...transportWithRest,
    registry: {
      ...transportWithRest.registry,
      fills: new Map([
        ...fills,
        [
          'core.transports',
          (fills.get('core.transports') ?? []).map((entry) => ({
            ...entry,
            fill: {
              ...(entry.fill as TransportAdapter),
              mount: (context: Parameters<TransportAdapter['mount']>[0]) => {
                seen.mounts.push(context.clock);
                return (entry.fill as TransportAdapter).mount(context);
              },
            },
          })),
        ],
      ]),
    },
  };
  const runtime = await startTransportRuntime({
    app: spied,
    host,
    config: { rest: { docs: false } },
    clock,
  });
  try {
    expect(seen.host).toBe(clock);
    expect(seen.mounts.length).toBeGreaterThan(0);
    expect(seen.mounts.every((mounted) => mounted === clock)).toBe(true);
  } finally {
    await runtime.stop();
  }
});
