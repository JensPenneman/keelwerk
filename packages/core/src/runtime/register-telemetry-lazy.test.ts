import { afterEach, describe, expect, test, vi } from 'vitest';
import { env } from '../dsl/env.ts';
import type { Logger } from '../observability/logger.ts';
import { registerTelemetry } from './register-telemetry.ts';

const loaded = vi.hoisted(() => ({ names: [] as string[] }));

vi.mock('@opentelemetry/sdk-trace', () => {
  loaded.names.push('sdk-trace');
  return {};
});
vi.mock('@opentelemetry/sdk-metrics', () => {
  loaded.names.push('sdk-metrics');
  return {};
});
vi.mock('@opentelemetry/resources', () => {
  loaded.names.push('resources');
  return {};
});
vi.mock('@opentelemetry/context-async-hooks', () => {
  loaded.names.push('context-async-hooks');
  return {};
});
vi.mock('@opentelemetry/exporter-trace-otlp-http', () => {
  loaded.names.push('exporter-trace-otlp-http');
  return {};
});
vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => {
  loaded.names.push('exporter-metrics-otlp-http');
  return {};
});

const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => log,
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, Symbol.for('keelwerk.telemetry'));
});

describe('registerTelemetry loads the SDK only for an endpoint', () => {
  test('a deployment without an endpoint never loads the OpenTelemetry SDK', async () => {
    await registerTelemetry({ telemetry: undefined, env: {}, log });
    await registerTelemetry({ telemetry: { otlp: env('KW_NONE') }, env: {}, log });
    expect(loaded.names).toEqual([]);
  });

  test('a deployment with an endpoint loads every SDK module (positive control)', async () => {
    await registerTelemetry({ telemetry: { otlp: 'http://127.0.0.1:9' }, env: {}, log });
    expect([...loaded.names].sort()).toEqual(
      [
        'context-async-hooks',
        'exporter-metrics-otlp-http',
        'exporter-trace-otlp-http',
        'resources',
        'sdk-metrics',
        'sdk-trace',
      ].sort(),
    );
  });
});
