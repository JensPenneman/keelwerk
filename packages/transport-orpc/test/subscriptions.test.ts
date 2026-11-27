import { requestHeaders, startTransportRuntime, transportTargetOf } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { orpcCodec } from './support/orpc-codec.ts';
import { orpcConformanceApp } from './support/orpc-conformance-app.ts';
import { orpcEchoApp } from './support/orpc-echo-app.ts';
import { orpcSpyApp } from './support/orpc-spy-app.ts';
import { orpcSubscribeOver } from './support/orpc-subscribe-over.ts';

const origins = ['https://app.example.test'];
const config = { orpc: { cors: origins } };
const runtime = await startTransportRuntime({
  app: orpcConformanceApp,
  host: httpHost(),
  config,
});
const single = await startTransportRuntime({
  app: orpcConformanceApp,
  host: httpHost({ live: { maxStreamsPerPrincipal: 1 } }),
  config,
});
const slashed = await startTransportRuntime({
  app: orpcEchoApp({ openapi: '/orpc-openapi' }),
  host: httpHost({ live: { maxStreamsPerPrincipal: 1 } }),
  config,
});
afterAll(async () => {
  await runtime.stop();
  await single.stop();
  await slashed.stop();
});
const target = transportTargetOf(runtime, orpcCodec, origins, true);
const slotted = transportTargetOf(single, orpcCodec, origins, true);

const tokenShape = /^v2\.[0-9a-z.]+$/;
const open = (caller: { subject: string }, rest: { after?: string; lastEventId?: string } = {}) =>
  orpcSubscribeOver(target, { action: 'loans.loanEvents', input: {}, caller, ...rest }, '/orpc');
const lend = (subject: string, bookTitle: string) =>
  orpcCodec.send(target, {
    action: 'loans.lend',
    input: { bookTitle, dueAt: '2026-12-01T00:00:00.000Z' },
    caller: { subject },
  });

describe('over the host', () => {
  test('the head and items carry the stream token as event id', async () => {
    const stream = await open({ subject: 'ada-head' });
    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
      const head = await stream.next();
      expect(head?.event).toBe('head');
      expect(head?.id).toMatch(tokenShape);
      expect(head?.id).toBe((head?.data as { state?: string } | undefined)?.state);
      await lend('ada-head', 'Dune');
      const item = await stream.next();
      expect(item?.event).toBe('data');
      expect(item?.id).toMatch(tokenShape);
      expect(item?.data).toMatchObject({ kind: 'created' });
    } finally {
      await stream.close();
    }
  });

  test('last-event-id resumes after the token', async () => {
    const first = await open({ subject: 'ada-resume' });
    let seen: string | undefined;
    try {
      await first.until((frame) => frame.event === 'head');
      await lend('ada-resume', 'Emma');
      seen = (await first.next())?.id;
    } finally {
      await first.close();
    }
    expect(seen).toMatch(tokenShape);
    await lend('ada-resume', 'Hamlet');
    const resumed = await open(
      { subject: 'ada-resume' },
      seen === undefined ? {} : { lastEventId: seen },
    );
    try {
      const frames = await resumed.until((frame) => frame.event === 'head');
      expect(frames.filter((frame) => frame.event === 'data')).toHaveLength(1);
    } finally {
      await resumed.close();
    }
  });

  test('a malformed token answers 400 before any stream', async () => {
    const stream = await open({ subject: 'ada-bad' }, { lastEventId: 'NOT A TOKEN!' });
    expect(stream.response.status).toBe(400);
    expect(stream.response.headers.get('content-type')).not.toContain('text/event-stream');
    await stream.close();
  });

  test('a reset without a state is the last event and has no id', async () => {
    const head = await open({ subject: 'ada-reset' });
    let current: string | undefined;
    try {
      current = (await head.until((frame) => frame.event === 'head')).at(-1)?.id;
    } finally {
      await head.close();
    }
    const [, epoch, position, scope, check] = (current ?? '').split('.');
    const old = await open(
      { subject: 'ada-reset' },
      { lastEventId: `v1.${epoch}.${position}.${scope}.${check?.slice(0, 8)}` },
    );
    try {
      const frames = await old.until((frame) => frame.event === 'reset');
      expect(frames.at(-1)).toMatchObject({ event: 'reset', data: { reason: 'resync' } });
      expect(frames.at(-1)?.id).toBeUndefined();
      expect(await old.next()).toBeUndefined();
    } finally {
      await old.close();
    }
  });

  test('a subscription holds a stream slot', async () => {
    const stream = (subject: string) =>
      orpcSubscribeOver(
        slotted,
        { action: 'loans.loanEvents', input: {}, caller: { subject } },
        '/orpc',
      );
    const first = await stream('ada-slot');
    try {
      expect(first.response.status).toBe(200);
      const second = await stream('ada-slot');
      expect(second.response.status).toBe(429);
      await second.close();
    } finally {
      await first.close();
    }
  });
});

describe('a request that reaches a subscription without saying so', () => {
  test('the real client sends no Accept, and a trailing slash is still a counted stream', async () => {
    const address = '203.0.113.91';
    const request = (path: string) => {
      const headers = requestHeaders({ subject: 'ada-slash' });
      headers.set('content-type', 'application/json');
      return single.fetch(
        new Request(`https://${single.domains.acme}${path}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ json: {} }),
        }),
        { remoteAddress: address },
      );
    };
    const first = await request('/orpc/loans/loanEvents');
    try {
      expect(first.status).toBe(200);
      expect(first.headers.get('content-type')).toContain('text/event-stream');
      const second = await request('/orpc/loans/loanEvents/');
      expect(second.status).toBe(429);
      await second.body?.cancel();
    } finally {
      await first.body?.cancel();
    }
  });
});

describe('a path with trailing slashes that oRPC still serves as the subscription', () => {
  const request = (method: string, path: string, caller: Parameters<typeof requestHeaders>[0]) => {
    const headers = requestHeaders(caller);
    if (method === 'POST') headers.set('content-type', 'application/json');
    return slashed.fetch(
      new Request(`https://${slashed.domains.acme}${path}`, {
        method,
        headers,
        ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
      }),
      { remoteAddress: '203.0.113.93' },
    );
  };

  test('are counted streams: the cap answers 429, as for the plain path', async () => {
    const first = await request('POST', '/orpc-openapi/loans/loanEvents', { subject: 'ada-many' });
    try {
      expect(first.status).toBe(200);
      for (const slashes of ['//', '///']) {
        const second = await request('POST', `/orpc-openapi/loans/loanEvents${slashes}`, {
          subject: 'ada-many',
        });
        expect(second.status).toBe(429);
        await second.body?.cancel();
      }
    } finally {
      await first.body?.cancel();
    }
  });

  test('are refused across sites exactly as the plain path is', async () => {
    const cross = { subject: 'ada-site', cookie: 'session', origin: 'https://evil.example' };
    const answers: number[] = [];
    for (const slashes of ['', '/', '//', '///']) {
      const answer = await request('GET', `/orpc-openapi/loans/loanEvents${slashes}`, cross);
      answers.push(answer.status);
      expect(await answer.text()).toContain('core.csrf');
    }
    expect(answers).toEqual([403, 403, 403, 403]);
  });
});

describe('a client that cancels the body of its stream', () => {
  test('aborts the invocation and frees the slot of its address', async () => {
    const signals: AbortSignal[] = [];
    const observed = await startTransportRuntime({
      app: orpcSpyApp(signals),
      host: httpHost({ live: { maxStreamsPerPrincipal: 1 } }),
      config,
    });
    const address = '203.0.113.92';
    const request = () => {
      const headers = requestHeaders({ subject: 'ada-cancel' });
      headers.set('content-type', 'application/json');
      headers.set('accept', 'text/event-stream');
      return observed.fetch(
        new Request(`https://${observed.domains.acme}/orpc/loans/loanEvents`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ json: {} }),
        }),
        { remoteAddress: address },
      );
    };
    try {
      const response = await request();
      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      if (reader === undefined) throw new Error('The stream has no body.');
      let text = '';
      while (!text.includes('head')) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('The stream ended before its head.');
        text += new TextDecoder().decode(chunk.value);
      }
      reader.releaseLock();
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(false);
      await response.body?.cancel();
      await vi.waitFor(() => expect(signals[0]?.aborted).toBe(true), {
        interval: 50,
      });
      // The slot is free again: a new stream of the same address is admitted at the cap of one.
      const again = await vi.waitFor(
        async () => {
          const next = await request();
          if (next.status !== 200) {
            await next.body?.cancel();
            throw new Error(`The stream was answered ${next.status}.`);
          }
          return next;
        },
        { interval: 50 },
      );
      await again.body?.cancel();
    } finally {
      await observed.stop();
    }
  }, 60_000);
});
