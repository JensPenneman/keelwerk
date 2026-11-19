import { describe, expect, test } from 'vitest';
import { asksForJsonLines } from '../src/mount/asks-for-json-lines.ts';
import { trpcStreams } from '../src/mount/trpc-streams.ts';
import {
  mountedTrpc,
  mutateTrpc,
  readTrpcAnswer,
  sendTrpc,
  trpcConformanceSurface,
  trpcUuidOf,
} from './support/trpc-kit.ts';

const about = () => ({ ok: true as const, value: { module: 'loans' } });
const lendInput = { bookTitle: 'Dune', dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z') };
const stream = (headers: Record<string, string>, path = 'loans.about') =>
  new Request(`https://portal.example/trpc/${path}?batch=1&input=%7B%7D`, { headers });

describe('JSON lines', () => {
  test('a JSON-lines batch is counted as a stream and streams', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const counted = mounted.registered[0]?.streams;
    for (const headers of [
      { 'trpc-accept': 'application/jsonl' },
      { accept: 'application/jsonl' },
      { accept: 'text/html, application/jsonl' },
    ]) {
      expect(counted?.(stream(headers), '/loans.about')).toBe(true);
      expect(trpcStreams(stream(headers))).toBe(true);
      const response = await sendTrpc(mounted.handler, 'loans.about', {
        search: 'batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D',
        headers,
      });
      expect(response.status).toBe(200);
      const lines = (await response.text()).trim().split('\n');
      expect(lines.length).toBeGreaterThan(1);
      for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
      expect(JSON.stringify(lines)).toContain('loans');
    }
  });

  test('a request the route does not count never streams JSON lines', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    for (const headers of [
      { 'trpc-accept': 'text/plain' },
      { 'trpc-accept': 'text/plain', accept: 'application/jsonl' },
      { accept: 'application/jsonl;q=0.5' },
      { accept: 'application/json' },
    ]) {
      expect(asksForJsonLines(new Headers(headers))).toBe(false);
      expect(mounted.registered[0]?.streams?.(stream(headers), '/loans.about')).toBe(false);
      const response = await sendTrpc(mounted.handler, 'loans.about', {
        search: 'batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%7D%7D%7D',
        headers,
      });
      expect(response.status).toBe(200);
      const body: unknown = await response.json();
      expect(Array.isArray(body)).toBe(true);
    }
  });

  test('a WebSocket upgrade is never counted as a stream and never throws', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const upgrade = {
      upgrade: 'websocket',
      connection: 'Upgrade',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
    };
    for (const more of [
      {},
      { accept: 'text/event-stream' },
      { accept: 'application/jsonl', 'trpc-accept': 'application/jsonl' },
    ]) {
      const request = stream({ ...upgrade, ...more });
      expect(trpcStreams(request)).toBe(false);
      expect(mounted.registered[0]?.streams?.(request, '/loans.about')).toBe(false);
    }
    expect(trpcStreams(stream({ ...upgrade, upgrade: 'h2c, WebSocket' }))).toBe(false);
    expect(trpcStreams(stream({ accept: 'text/event-stream' }))).toBe(true);
  });

  test('a JSON-lines request that is no batch is refused without a failure of the transport', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const response = await sendTrpc(mounted.handler, 'loans.about', {
      headers: { 'trpc-accept': 'application/jsonl' },
    });
    expect(response.status).toBe(400);
  });
});

describe('subscription and command gates', () => {
  test('a subscription without Accept: text/event-stream is refused 406 before it runs', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      subscribe: () => (async function* () {})(),
    });
    const answer = await readTrpcAnswer(await sendTrpc(mounted.handler, 'loans.loanEvents'));
    expect(answer.status).toBe(406);
    expect(answer.body.error.json.data.keelwerk).toMatchObject({ code: 'core.unsupported' });
    expect(answer.body.error.json.data.httpStatus).toBe(406);
    expect(mounted.subscribed).toEqual([]);
  });

  test('a path that starts with two slashes stays a path and never names a host', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      subscribe: () => (async function* () {})(),
    });
    for (const headers of [{}, { accept: 'text/event-stream' }]) {
      const response = await sendTrpc(mounted.handler, '/evil.test/loans.loanEvents', { headers });
      expect(response.headers.get('content-type')).not.toContain('text/event-stream');
      await response.body?.cancel();
      expect(mounted.subscribed).toEqual([]);
    }
  });

  test('a doubled slash cannot hide a subscription from the 406 gate', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      subscribe: () => (async function* () {})(),
    });
    for (const path of ['/loans.loanEvents', 'loans.loanEvents//', '/loans.loanEvents//']) {
      for (const headers of [{ accept: 'application/json' }, { accept: 'text/event-stream' }, {}]) {
        const response = await sendTrpc(mounted.handler, path, { headers });
        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).not.toContain('text/event-stream');
        await response.body?.cancel();
      }
    }
    expect(mounted.subscribed).toEqual([]);
  });

  test('a subscription in a batch is refused', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about, {
      subscribe: () => (async function* () {})(),
    });
    const answer = await readTrpcAnswer(
      await sendTrpc(mounted.handler, 'loans.about,loans.loanEvents', {
        search: 'batch=1',
        headers: { accept: 'text/event-stream' },
      }),
    );
    expect(answer.status).toBe(406);
    expect(mounted.subscribed).toEqual([]);
    expect(mounted.calls).toEqual([]);
  });

  test('Idempotency-Key with two calls is refused', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const response = await sendTrpc(mounted.handler, 'loans.about,loans.about', {
      search: 'batch=1',
      headers: { 'idempotency-key': trpcUuidOf(1) },
    });
    expect(response.status).toBe(400);
    expect(mounted.calls).toEqual([]);
  });

  test('Prefer: respond-async with two calls is refused', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    const response = await sendTrpc(mounted.handler, 'loans.about,loans.about', {
      search: 'batch=1',
      headers: { prefer: 'respond-async' },
    });
    expect(response.status).toBe(400);
    expect(mounted.calls).toEqual([]);
  });

  test('a one-call command answers keelwerk-command-id and its replay the same outcome', async () => {
    const key = '0198a1e0-0000-7000-8000-000000000042';
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({
      ok: true,
      value: { loanId: trpcUuidOf(1) },
    }));
    const first = await mutateTrpc(mounted.handler, 'loans.lend', lendInput, {
      headers: { 'idempotency-key': key },
    });
    const second = await mutateTrpc(mounted.handler, 'loans.lend', lendInput, {
      headers: { 'idempotency-key': key },
    });
    expect(first.headers.get('keelwerk-command-id')).toBe(key);
    expect(second.headers.get('keelwerk-command-id')).toBe(key);
    expect(second.body).toEqual(first.body);
    expect(mounted.calls.map((call) => call.commandId)).toEqual([key, key]);
    const generated = await mutateTrpc(mounted.handler, 'loans.lend', lendInput);
    expect(generated.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.headers.get('keelwerk-command-id')).not.toBe(key);
  });

  test('a key that is no command id is refused, the kernel form too', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), about);
    for (const key of ['not-an-id', 'kw:reserved']) {
      const answer = await mutateTrpc(mounted.handler, 'loans.lend', lendInput, {
        headers: { 'idempotency-key': key },
      });
      expect(answer.status).toBe(400);
    }
    expect(mounted.calls).toEqual([]);
  });

  test('Prefer: respond-async answers the receipt with preference-applied and the effects', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({
      ok: true,
      value: undefined,
      receipt: { commandId: trpcUuidOf(5), status: 'accepted' },
      effects: ['effect-a', 'effect-b'],
    }));
    const answer = await mutateTrpc(mounted.handler, 'loans.lend', lendInput, {
      headers: { prefer: 'respond-async' },
    });
    expect(answer.status).toBe(200);
    expect(answer.body.result.data.json).toEqual({ commandId: trpcUuidOf(5), status: 'accepted' });
    expect(answer.headers.get('preference-applied')).toBe('respond-async');
    expect(answer.headers.get('keelwerk-effects')).toBe('effect-a,effect-b');
    expect(mounted.calls[0]?.prefer).toBe('async');
  });
});
