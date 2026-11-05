import { startTransportRuntime, transportTargetOf } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { restCodec } from './support/rest-codec.ts';
import { transportWithRest } from './support/transport-app.ts';

const small = await startTransportRuntime({
  app: transportWithRest,
  host: httpHost(),
  config: { rest: { maxBodyBytes: 1024 } },
});
const normal = await startTransportRuntime({ app: transportWithRest, host: httpHost() });
afterAll(async () => {
  await small.stop();
  await normal.stop();
});

const padded = {
  action: 'loans.lend',
  input: { bookTitle: 'Dune', dueAt: '2026-12-01T00:00:00Z', pad: 'x'.repeat(2000) },
  caller: { subject: 'ada' },
} as const;

describe('the backend configuration reaches the mounted transport', () => {
  test('the body limit of the backend is the one REST applies', async () => {
    const limited = await restCodec.send(transportTargetOf(small, restCodec, []), padded);
    expect(limited.decoded).toEqual({
      ok: false,
      kind: 'validation',
      code: 'core.payload_too_large',
    });
    expect(limited.response.status).toBe(413);
  });

  test('a backend without the setting gets the default of the module', async () => {
    const sent = await restCodec.send(transportTargetOf(normal, restCodec, []), padded);
    expect(sent.response.status).toBe(422);
  });
});
