import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { readEventStream, startTransportRuntime, type TestSocket } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, onTestFinished, test } from 'vitest';
import { apiKeys } from '../src/module.generated.ts';
import { keyOwnerSubject } from './support/api-key-calls.ts';

const readOnlyReason = 'This API key has the read scope only.';
const streamsApp = defineApp({ id: 'keys-streams', modules: [apiKeys, library, loans, live] });

async function boot() {
  const started = await startTransportRuntime({
    app: streamsApp,
    host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
    tenants: ['acme'],
  });
  onTestFinished(() => started.stop());
  const tenantId = started.tenants.acme;
  const domain = started.domains.acme;
  if (tenantId === undefined || domain === undefined)
    throw new Error('The tenant acme is missing.');
  const origin = `https://${domain}`;
  const nextConnection = () => ({
    id: 'c1',
    listener: 'http',
    remote: { address: '203.0.113.9', port: 40000 },
    local: { address: '127.0.0.1', port: 8080 },
  });
  /** Invokes an action through the runtime's invoker on a transport, as its owner or presenting a key. */
  const invoke = (
    action: string,
    input: unknown,
    as: { readonly transport: string; readonly key?: string },
  ) =>
    started.runtime.invoker.invoke({
      action,
      input,
      carrier: {
        transport: as.transport,
        headers: {
          'x-tenant': tenantId,
          ...(as.key === undefined
            ? {
                'x-test-principal': JSON.stringify({
                  subject: keyOwnerSubject,
                  roles: [],
                  claims: {},
                }),
              }
            : { authorization: `Bearer ${as.key}` }),
        },
        connection: nextConnection(),
      },
      requestId: crypto.randomUUID(),
      signal: new AbortController().signal,
    });
  const createKey = async (scopes: readonly string[]): Promise<string> => {
    const made = await invoke(
      'api-keys.create',
      { label: 'stream', scopes },
      { transport: 'test' },
    );
    if (!made.ok) throw made.error;
    return (made.value as { key: string }).key;
  };
  return { started, origin, invoke, createKey };
}

type Message = { readonly type: string; readonly [member: string]: unknown };

/** The next message of a live socket; a notice is skipped. */
async function nextMessage(socket: TestSocket): Promise<Message> {
  for (;;) {
    const message = JSON.parse(String(await socket.next())) as Message;
    if (message.type !== 'notice') return message;
  }
}

describe('a key and the streams', () => {
  test('a read-only key opens a server-sent stream with its header alone', async () => {
    const { started, origin, createKey } = await boot();
    const key = await createKey(['read']);
    const response = await started.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    const stream = readEventStream(response);
    onTestFinished(() => stream.close());
    expect(response.status).toBe(200);
    const frames = await stream.until((frame) => frame.event === 'head');
    expect(frames.map((frame) => frame.event)).toEqual(['welcome', 'head']);
  });

  test('a read-only key opens a socket with its upgrade header, and with the token of its hello', async () => {
    const { started, origin, createKey } = await boot();
    const connect = started.connect;
    if (connect === undefined) throw new Error('The runtime has no connect hook.');
    const key = await createKey(['read']);
    const upgrade = (authorization?: string) =>
      connect(
        new Request(`${origin}/_keelwerk/v1/live`, {
          headers: {
            'sec-websocket-protocol': 'keelwerk.live.v1',
            ...(authorization === undefined ? {} : { authorization }),
          },
        }),
      );
    const subscribed = async (opened: Awaited<ReturnType<typeof upgrade>>, hello: object) => {
      if (opened.kind !== 'open') throw new Error(`Refused: ${opened.response.status}.`);
      const { socket } = opened;
      onTestFinished(() => socket.close());
      socket.send(JSON.stringify({ type: 'hello', ...hello }));
      expect((await nextMessage(socket)).type).toBe('welcome');
      socket.send(
        JSON.stringify({ type: 'subscribe', id: 's1', action: 'loans.loanEvents', input: {} }),
      );
      expect(await nextMessage(socket)).toMatchObject({ type: 'head', id: 's1' });
    };
    await subscribed(await upgrade(`Bearer ${key}`), {});
    await subscribed(await upgrade(), { token: key });
  });

  test('a read-only key is refused a stream ticket with the rule reason', async () => {
    const { invoke, createKey } = await boot();
    const key = await createKey(['read']);
    const outcome = await invoke('live.ticket', {}, { transport: 'http', key });
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error.kind).toBe('forbidden');
    expect(outcome.ok ? '' : outcome.error.message).toContain(readOnlyReason);
  });

  test('a ticket a cli-bound write key issued on cli is refused over http', async () => {
    const { started, origin, invoke, createKey } = await boot();
    const redeem = async (scopes: readonly string[]) => {
      const key = await createKey(scopes);
      const issued = await invoke(
        'live.ticket',
        { action: 'loans.loanEvents' },
        { transport: 'cli', key },
      );
      if (!issued.ok) throw issued.error;
      const { ticket } = issued.value as { ticket: string };
      return started.fetch(
        new Request(
          `${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents&ticket=${encodeURIComponent(ticket)}`,
        ),
      );
    };
    // The control: a ticket issued the same way by a key that names no transport opens the stream, so
    // the refusal below can only come from the binding.
    const open = await redeem(['write']);
    const stream = readEventStream(open);
    onTestFinished(() => stream.close());
    expect(open.status).toBe(200);
    expect((await stream.until((frame) => frame.event === 'welcome')).map((f) => f.event)).toEqual([
      'welcome',
    ]);
    const response = await redeem(['write', 'transport:cli']);
    expect(await response.json()).toMatchObject({ error: { code: 'core.ticket_invalid' } });
    expect(response.ok).toBe(false);
  });

  test('the same key over http is refused its own header: it names cli only', async () => {
    const { started, origin, createKey } = await boot();
    const key = await createKey(['write', 'transport:cli']);
    const response = await started.fetch(
      new Request(`${origin}/_keelwerk/v1/subscribe?action=loans.loanEvents`, {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect(response.ok).toBe(false);
    expect(await response.json()).toMatchObject({ error: { code: 'core.unauthenticated' } });
  });
});
