import { defineApp, newUuidV7, renderTypeId } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import {
  freshName,
  lendCall,
  originOf,
  requestHeaders,
  sendCall,
  startTransportRuntime,
  transportTargetOf,
} from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { rest } from '../src/index.ts';
import { restCodec } from './support/rest-codec.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const origins = ['https://app.example.test'];
const options = { host: httpHost(), config: { rest: { docs: false, cors: origins } } };
const liveApp = defineApp({ id: 'streams', modules: [live, library, loans, rest] });
const plainApp = defineApp({ id: 'plain', modules: [library, loans, rest] });
const withLive = await startTransportRuntime({ ...options, app: liveApp });
const withoutLive = await startTransportRuntime({ ...options, app: plainApp });
afterAll(async () => {
  await withLive.stop();
  await withoutLive.stop();
});

const target = transportTargetOf(withLive, restCodec, origins, true);
const plain = transportTargetOf(withoutLive, restCodec, origins, false);
const tokenShape = /^v2\.[0-9a-z.]+$/;

function open(path: string, subject: string | null, headers: Record<string, string> = {}) {
  const caller = subject === null ? {} : { subject };
  const sent = new Headers(requestHeaders(caller));
  for (const [name, value] of Object.entries(headers)) sent.set(name, value);
  return target.fetch(new Request(`${originOf(target, caller)}${path}`, { headers: sent }));
}

const streamAccept = { accept: 'text/event-stream' };

describe('REST subscription routes', () => {
  test('loan-events streams welcome, head and the loan that is created', async () => {
    const ada = freshName('ada');
    const stream = await restCodec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: { subject: ada },
    });
    if (stream === undefined) throw new Error('no stream');
    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
      expect((await stream.next())?.event).toBe('welcome');
      expect((await stream.next())?.event).toBe('head');
      await sendCall(target, lendCall(ada, freshName('Dune')));
      const item = await stream.next();
      expect(item).toMatchObject({ event: 'data', data: { kind: 'created' } });
      expect(item?.id).toMatch(tokenShape);
    } finally {
      await stream.close();
    }
  });

  test('the generated watch reads its input from the query and resumes from Last-Event-ID', async () => {
    const ada = freshName('ada');
    const first = await restCodec.subscribe?.(target, {
      action: 'loans.loan.watch',
      input: {},
      caller: { subject: ada },
    });
    if (first === undefined) throw new Error('no stream');
    let seen: string | undefined;
    try {
      expect(first.response.status).toBe(200);
      await first.until((frame) => frame.event === 'head');
      await sendCall(target, lendCall(ada, freshName('Emma')));
      const item = await first.until((frame) => frame.event === 'data');
      seen = item.at(-1)?.id;
    } finally {
      await first.close();
    }
    expect(seen).toMatch(tokenShape);
    await sendCall(target, lendCall(ada, freshName('Hamlet')));
    const resumed = await restCodec.subscribe?.(target, {
      action: 'loans.loan.watch',
      input: {},
      caller: { subject: ada },
      ...(seen === undefined ? {} : { lastEventId: seen }),
    });
    if (resumed === undefined) throw new Error('no stream');
    try {
      const frames = await resumed.until((frame) => frame.event === 'head');
      expect(frames.filter((frame) => frame.event === 'data')).toHaveLength(1);
    } finally {
      await resumed.close();
    }
  });

  test('a malformed Last-Event-ID or after is a 400 problem, not a stream', async () => {
    const ada = freshName('ada');
    const header = await open('/api/loans/loan-events', ada, {
      ...streamAccept,
      'last-event-id': 'NOT A TOKEN!',
    });
    expect(header.status).toBe(400);
    expect(header.headers.get('content-type')).toContain('application/problem+json');
    const query = await open('/api/loans/loan-events?after=NOT%20A%20TOKEN!', ada, streamAccept);
    expect(query.status).toBe(400);
    expect(query.headers.get('content-type')).toContain('application/problem+json');
    await header.body?.cancel();
    await query.body?.cancel();
  });

  test('an anonymous caller of loan-events gets a 401 problem, not an error event', async () => {
    const response = await open('/api/loans/loan-events', null, streamAccept);
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    await response.body?.cancel();
  });

  test('a request without Accept: text/event-stream is a 400 core.malformed_request', async () => {
    const response = await open('/api/loans/loan-events', freshName('ada'));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'core.malformed_request' });
  });

  test('HEAD is a 400 core.malformed_request', async () => {
    const caller = { subject: freshName('ada') };
    const response = await target.fetch(
      new Request(`${originOf(target, caller)}/api/loans/loan-events`, {
        method: 'HEAD',
        headers: { ...Object.fromEntries(requestHeaders(caller)), ...streamAccept },
      }),
    );
    expect(response.status).toBe(400);
  });

  test('an unknown query parameter is a 422 validation problem', async () => {
    const response = await open('/api/loans/loan-events?bogus=1', freshName('ada'), streamAccept);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'core.validation' });
  });

  test('a ticket in the query is no credential on a REST path: it is ignored as an unknown parameter', async () => {
    const response = await open(
      `/api/loans/loan-events?ticket=${'a'.repeat(43)}`,
      freshName('ada'),
      streamAccept,
    );
    expect(response.status).toBe(422);
    await response.body?.cancel();
  });

  test('a deployment without the live module answers core.live_unavailable', async () => {
    const caller = { subject: freshName('ada') };
    const response = await plain.fetch(
      new Request(
        `${originOf(plain, caller)}/api/core/effect-status-watch?ids=${renderTypeId('eff', newUuidV7())}`,
        {
          headers: { ...Object.fromEntries(requestHeaders(caller)), ...streamAccept },
        },
      ),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'core.live_unavailable' });
  });
});
