import type { DeploymentDefinition } from '@keelwerk/core';
import { metrics, type Tracer, type TracerProvider, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootApp } from '../src/serve/boot-app.ts';
import type { HostDeps } from '../src/serve/http-host-entry-of.ts';

vi.mock('@keelwerk/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@keelwerk/core')>()),
  startRuntime: async () => ({ stop: async () => undefined }),
}));

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => logger,
};

/** Boots an empty deployment whose host entry records the dependencies it is given. */
async function hostDepsOf(telemetry: DeploymentDefinition['telemetry']): Promise<HostDeps> {
  let seen: HostDeps | undefined;
  const entry = {
    kind: 'httpHost',
    provides: [],
    create: (deps: HostDeps) => {
      seen = deps;
      return { listen: async () => ({}), stop: async () => undefined };
    },
  };
  const definition = {
    apps: [],
    infrastructure: [entry],
    ...(telemetry === undefined ? {} : { telemetry }),
  } as unknown as DeploymentDefinition;
  const booted = await bootApp(definition, {
    role: 'all',
    environment: 'development',
    env: {},
    logger: logger as never,
  });
  await booted.stop(0);
  if (seen === undefined) throw new Error('the host entry was not built');
  return seen;
}

afterEach(() => {
  trace.disable();
  metrics.disable();
});

describe('the telemetry the served host receives', () => {
  test('a deployment with telemetry.otlp reaches the registered OpenTelemetry provider', async () => {
    const started: string[] = [];
    const tracer = {
      startSpan: (name: string) => {
        started.push(name);
        return trace.wrapSpanContext({ traceId: '0', spanId: '0', traceFlags: 0 });
      },
    } as unknown as Tracer;
    const provider: TracerProvider = { getTracer: () => tracer };
    expect(trace.setGlobalTracerProvider(provider)).toBe(true);

    const deps = await hostDepsOf({ otlp: 'http://collector:4318' });
    deps.telemetry.tracer.startSpan('probe');

    expect(started).toEqual(['probe']);
    expect(typeof deps.telemetry.meter.createCounter).toBe('function');
  });

  test('without a registered provider the no-op API objects are used', async () => {
    const deps = await hostDepsOf(undefined);

    const span = deps.telemetry.tracer.startSpan('probe');
    expect(span.isRecording()).toBe(false);
    expect(() => deps.telemetry.meter.createCounter('c').add(1)).not.toThrow();
  });
});
