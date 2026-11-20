import { startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { orpcEchoApp } from './support/orpc-echo-app.ts';

const origin = 'https://app.example.test';
const bare = await startTransportRuntime({ app: orpcEchoApp(), host: httpHost() });
const configured = await startTransportRuntime({
  app: orpcEchoApp(),
  host: httpHost(),
  config: { orpc: { cors: [origin] } },
});
afterAll(async () => {
  await bare.stop();
  await configured.stop();
});

function preflight(runtime: typeof bare): Promise<Response> {
  return runtime.fetch(
    new Request(`https://${runtime.domains.acme}/orpc/echo/limited`, {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'idempotency-key',
      },
    }),
  );
}

describe('the cors setting of the module', () => {
  test('a backend without an orpc entry allows no foreign origin', async () => {
    const answer = await preflight(bare);
    expect(answer.headers.get('access-control-allow-origin')).toBeNull();
  });

  test('a listed origin gets its preflight answered, Idempotency-Key allowed', async () => {
    const answer = await preflight(configured);
    expect(answer.status).toBe(204);
    expect(answer.headers.get('access-control-allow-origin')).toBe(origin);
    expect(answer.headers.get('access-control-allow-headers')).toContain('idempotency-key');
  });
});
