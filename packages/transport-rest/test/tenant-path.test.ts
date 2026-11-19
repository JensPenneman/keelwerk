import { commandReceiptId, renderTypeId } from '@keelwerk/core';
import {
  freshName,
  lendCall,
  sendCall,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { restCodec } from './support/rest-codec.ts';
import { transportWithRest } from './support/transport-app.ts';

const runtime = await startTransportRuntime({
  app: transportWithRest,
  host: httpHost(),
  config: { rest: { docs: false, cors: [] } },
});
afterAll(async () => {
  await runtime.stop();
});
const target = transportTargetOf(runtime, restCodec, []);
const acme = target.tenants.acme;
if (acme === undefined) throw new Error('The target has no tenant acme.');
const acmePrefix = `/t/${renderTypeId('tnt', acme.id)}`;

describe('REST below a tenant prefix', () => {
  test('an accepted command below a tenant prefix answers a Location under that prefix', async () => {
    const subject = freshName('ada');
    const commandId = crypto.randomUUID();
    const sent = await sendCall(
      target,
      lendCall(subject, freshName('Emma'), {
        commandId,
        prefer: 'async',
        caller: { subject, pathPrefix: acmePrefix },
      }),
    );
    expect(sent.response.headers.get('location')).toBe(
      `${acmePrefix}/api/core/command-receipts/${commandReceiptId(acme.id, commandId)}`,
    );
  });

  test('a REST problem below a tenant prefix names its type under that prefix', async () => {
    const response = await target.fetch(
      new Request(`https://${acme.domain}${acmePrefix}/api/no-such-route`),
    );
    expect(response.status).toBe(404);
    const problem = (await response.json()) as { type?: string };
    expect(problem.type).toBe(`https://${acme.domain}${acmePrefix}/api/problems/core.not_found`);
  });
});
