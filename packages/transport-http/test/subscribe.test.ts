import type { LiveCarrier } from '@keelwerk/core';
import { readEventStream, recordingLogger, startTransportRuntime } from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { httpHost } from '../src/index.ts';
import { createFakeHost } from './support/create-fake-host.ts';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSurface } from './support/fake-surface.ts';
import { type StreamRuntime, startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000 });

/** A name no earlier test used. */
const freshNameOf = (label: string): string => `${label}-${crypto.randomUUID().slice(0, 8)}`;

const running: StreamRuntime[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
  await Promise.all(running.splice(0).map((started) => started.runtime.stop()));
});

async function started(...args: Parameters<typeof startStreamRuntime>): Promise<StreamRuntime> {
  const made = await startStreamRuntime(...args);
  running.push(made);
  return made;
}

const ada = (name = 'ada') => ({ subject: name });
const lend = (subject: string, title: string) => ({
  action: 'loans.lend',
  input: { bookTitle: title, dueAt: '2027-01-01T00:00:00Z' },
  caller: { subject },
});

describe('GET and POST subscribe', () => {
  test('GET and POST stream welcome, head and wire-encoded items', async () => {
    const { target } = await started();
    const subject = freshNameOf('ada');
    for (const method of ['GET', 'POST'] as const) {
      const stream = await target.codec.subscribe?.(target, {
        action: 'loans.loanEvents',
        input: {},
        caller: ada(subject),
        method,
      });
      if (stream === undefined) throw new Error('no stream');
      closers.push(() => stream.close());
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(stream.response.headers.get('cache-control')).toBe('no-store');
      expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
      const frames = await stream.until((frame) => frame.event === 'head');
      expect(frames.map((frame) => frame.event)).toEqual(['welcome', 'head']);
      await target.codec.send(target, lend(subject, freshNameOf('Dune')));
      const item = await stream.next();
      expect(item?.event).toBe('data');
      // The item is the wire form: a TypeID, not the stored uuid.
      expect((item?.data as { loanId?: string } | undefined)?.loanId).toMatch(/^loan_/);
    }
  });

  test('Last-Event-ID wins over after', async () => {
    const { target } = await started();
    const subject = freshNameOf('ada');
    const first = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(subject),
    });
    if (first === undefined) throw new Error('no stream');
    await first.until((frame) => frame.event === 'head');
    await target.codec.send(target, lend(subject, freshNameOf('Emma')));
    const seen = (await first.next())?.id;
    await first.close();
    await target.codec.send(target, lend(subject, freshNameOf('Hamlet')));
    // `after` names a token of another position than the header: the header decides.
    const resumed = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(subject),
      after: 'v2.0.1.00000000.00000000000000000000000000000000',
      ...(seen === undefined ? {} : { lastEventId: seen }),
    });
    if (resumed === undefined) throw new Error('no stream');
    closers.push(() => resumed.close());
    const frames = await resumed.until(
      (frame) => frame.event === 'head' || frame.event === 'error',
    );
    expect(frames.map((frame) => frame.event)).toEqual(['welcome', 'data', 'head']);
  });

  test('a token too long, with other characters, two values or not in the form of a state token is 400 and never logged', async () => {
    const { target, lines, origin } = await started();
    const hostile = 'a'.repeat(200);
    const urls = [
      `after=${hostile}`,
      'after=SECRET%20VALUE',
      'after=one&after=two',
      'after=v2.zz',
      'after=abc',
      'action=loans.loanEvents&after=bad%24token',
    ].map(
      (query) =>
        `${origin}/_keelwerk/v1/subscribe?${query.startsWith('action') ? '' : 'action=loans.loanEvents&'}${query}`,
    );
    for (const url of urls) {
      const response = await target.fetch(
        new Request(url, {
          headers: {
            'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
          },
        }),
      );
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'core.malformed_request',
      );
    }
    const header = await target.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: {
          'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
          'last-event-id': 'SECRET, VALUE',
        },
      }),
    );
    expect(header.status).toBe(400);
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain(hostile);
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('bad$token');
  });

  test('an unknown action is not found, a command unsupported', async () => {
    const { target, origin } = await started();
    const headers = {
      'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
    };
    const unknown = await target.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.nothing`, { headers }),
    );
    expect(unknown.status).toBe(404);
    const command = await target.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.lend`, { headers }),
    );
    expect(command.status).toBe(422);
    expect(((await command.json()) as { error: { code: string } }).error.code).toBe(
      'core.unsupported',
    );
  });

  test('responses are never compressed', async () => {
    const { target, origin } = await started();
    const response = await target.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: {
          'accept-encoding': 'br, gzip',
          'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
        },
      }),
    );
    expect(response.headers.get('content-encoding')).toBeNull();
    const stream = readEventStream(response);
    closers.push(() => stream.close());
    expect((await stream.next())?.event).toBe('welcome');
  });
});

describe('without live', () => {
  test('the endpoint is not found', async () => {
    const runtime = await startTransportRuntime({ app: transportApp, host: httpHost() });
    try {
      const domain = Object.values(runtime.domains)[0] ?? '';
      const response = await runtime.fetch(
        new Request(`https://${domain}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
          headers: {
            'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
          },
        }),
      );
      expect(response.status).toBe(404);
    } finally {
      await runtime.stop();
    }
  });
});

describe('a surface failure', () => {
  test('answers 500 and logs once', async () => {
    const lines: Parameters<typeof recordingLogger>[0] = [];
    const carrier: LiveCarrier = { name: 'sse', serve: async () => undefined };
    const { host } = createFakeHost(
      {},
      {
        invoker: createFakeInvoker(),
        surface: fakeSurface([]),
        deps: {
          log: recordingLogger(lines),
          surface: () => {
            throw new Error('the projection of this version failed');
          },
          liveCarrier: () => carrier,
        },
      },
    );
    try {
      const response = await host.fetch(
        new Request('https://x.example/_keelwerk/v1/subscribe?action=loans.loanEvents'),
      );
      expect(response.status).toBe(500);
      expect(lines.filter((line) => line.level === 'error')).toHaveLength(1);
    } finally {
      await host.stop(100);
    }
  });
});

describe('the life of a stream', () => {
  test('streams end going_away at stop', async () => {
    const made = await startStreamRuntime();
    const { target } = made;
    const stream = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(freshNameOf('ada')),
    });
    if (stream === undefined) throw new Error('no stream');
    await stream.until((frame) => frame.event === 'head');
    const stopping = made.runtime.stop();
    const rest = await stream.until((frame) => frame.event === 'end');
    await stopping;
    expect(rest.at(-1)).toMatchObject({ event: 'end', data: { reason: 'going_away' } });
  });

  test('max_duration ends a stream', async () => {
    const { target } = await started({ live: { maxDurationMs: 300 } });
    const stream = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(freshNameOf('ada')),
    });
    if (stream === undefined) throw new Error('no stream');
    closers.push(() => stream.close());
    const frames = await stream.until((frame) => frame.event === 'end');
    expect(frames.at(-1)).toMatchObject({ event: 'end', data: { reason: 'max_duration' } });
  });

  test('the 21st stream of a principal is 429 core.quota_exceeded', async () => {
    const { target, origin } = await started();
    const subject = freshNameOf('ada');
    for (let index = 0; index < 20; index += 1) {
      const stream = await target.codec.subscribe?.(target, {
        action: 'loans.loanEvents',
        input: {},
        caller: ada(subject),
      });
      if (stream === undefined) throw new Error('no stream');
      closers.push(() => stream.close());
      expect(stream.response.status).toBe(200);
    }
    const refused = await target.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: { 'x-test-principal': JSON.stringify({ subject, roles: [], claims: {} }) },
      }),
    );
    expect(refused.status).toBe(429);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'core.quota_exceeded',
    );
    // Another principal is not counted against this one.
    const other = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(freshNameOf('bob')),
    });
    expect(other?.response.status).toBe(200);
    await other?.close();
  });

  test('a client that does not read is closed after stallMs and its subscription ended', async () => {
    const { target } = await started({
      live: { maxBufferedBytes: 300, stallMs: 150, maxStreamsPerPrincipal: 1 },
    });
    const subject = freshNameOf('ada');
    const silent = await target.codec.subscribe?.(target, {
      action: 'loans.loanEvents',
      input: {},
      caller: ada(subject),
    });
    expect(silent?.response.status).toBe(200);
    // Never read: the queue fills, the carrier waits, and after stallMs the connection is closed.
    for (let index = 0; index < 8; index += 1) {
      await target.codec.send(target, lend(subject, freshNameOf('Book')));
    }
    // The principal's one stream is released: it may open another.
    await vi.waitFor(
      async () => {
        const again = await target.codec.subscribe?.(target, {
          action: 'loans.loanEvents',
          input: {},
          caller: ada(subject),
        });
        expect(again?.response.status).toBe(200);
        await again?.close();
      },
      { timeout: 5000, interval: 50 },
    );
  });
});
