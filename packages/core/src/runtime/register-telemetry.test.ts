import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { context, metrics, trace } from '@opentelemetry/api';
import { afterEach, describe, expect, test } from 'vitest';
import { env } from '../dsl/env.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { Logger } from '../observability/logger.ts';
import { registerTelemetry } from './register-telemetry.ts';

interface Received {
  readonly method: string | undefined;
  readonly path: string | undefined;
  readonly body: string;
}

const warnings: string[] = [];
const log: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: (message) => {
    warnings.push(message);
  },
  error: () => undefined,
  child: () => log,
};
const key = Symbol.for('keelwerk.telemetry');
const servers: Server[] = [];

afterEach(async () => {
  trace.disable();
  metrics.disable();
  context.disable();
  Reflect.deleteProperty(globalThis, key);
  warnings.length = 0;
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function receiver(): Promise<{ url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      received.push({
        method: request.method,
        path: request.url,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, received };
}

async function refusal(work: Promise<unknown>): Promise<KeelwerkError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof KeelwerkError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('registerTelemetry (S-141, open point 460)', () => {
  test('without telemetry.otlp nothing is registered and the flush resolves', async () => {
    const flush = await registerTelemetry({ telemetry: undefined, env: {}, log });
    await expect(flush(100)).resolves.toBeUndefined();
    expect(Reflect.get(globalThis, key)).toBeUndefined();
  });

  test('an env() endpoint that is not set registers nothing', async () => {
    const flush = await registerTelemetry({
      telemetry: { otlp: env('KW_OTLP_ENDPOINT') },
      env: {},
      log,
    });
    await expect(flush(100)).resolves.toBeUndefined();
    expect(Reflect.get(globalThis, key)).toBeUndefined();
  });

  test('a value that is neither a URL nor env() is refused with validation', async () => {
    const error = await refusal(registerTelemetry({ telemetry: { otlp: 42 }, env: {}, log }));
    expect(error.kind).toBe('validation');
    const named = await refusal(
      registerTelemetry({
        telemetry: { otlp: env('KW_OTLP_ENDPOINT') },
        env: Object.fromEntries([['KW_OTLP_ENDPOINT', 'ftp://secret-host']]),
        log,
      }),
    );
    expect(named.message).toContain('KW_OTLP_ENDPOINT');
    expect(named.message).not.toContain('secret-host');
    await refusal(registerTelemetry({ telemetry: { otlp: 'not a url' }, env: {}, log }));
  });

  test('spans reach the receiver at <endpoint>/v1/traces after the flush', async () => {
    const { url, received } = await receiver();
    const flush = await registerTelemetry({ telemetry: { otlp: `${url}/` }, env: {}, log });
    trace.getTracer('test').startSpan('a-recorded-span').end();
    await flush(2000);
    const posted = received.find((item) => item.path === '/v1/traces');
    expect(posted?.method).toBe('POST');
    expect(posted?.body).toContain('a-recorded-span');
    expect(posted?.body).toContain('keelwerk');
  });

  test('a second registration in the process keeps the first and answers the same flush', async () => {
    const { url, received } = await receiver();
    const first = await registerTelemetry({ telemetry: { otlp: url }, env: {}, log });
    const provider = trace.getTracerProvider();
    const delegate = (provider as unknown as { getDelegate(): unknown }).getDelegate();
    const second = await registerTelemetry({ telemetry: { otlp: url }, env: {}, log });
    expect(second).toBe(first);
    expect((trace.getTracerProvider() as unknown as { getDelegate(): unknown }).getDelegate()).toBe(
      delegate,
    );
    trace.getTracer('test').startSpan('once').end();
    await second(2000);
    expect(received.filter((item) => item.path === '/v1/traces')).toHaveLength(1);
    const other = await registerTelemetry({
      telemetry: { otlp: 'http://127.0.0.1:9' },
      env: {},
      log,
    });
    expect(other).toBe(first);
    expect(warnings).toHaveLength(1);
  });
});
