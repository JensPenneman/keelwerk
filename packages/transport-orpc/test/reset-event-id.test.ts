import { requestHeaders, startTransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { describe, expect, test } from 'vitest';
import { orpcSpyApp } from './support/orpc-spy-app.ts';

const config = { orpc: { cors: [] } };

describe('a reset on the wire', () => {
  const token = (n: number) => `v2.0.${n}.00000000.00000000000000000000000000000000`;

  type Scripted = Awaited<ReturnType<typeof startTransportRuntime>>;

  const subscribe = (scripted: Scripted): Promise<Response> => {
    const headers = requestHeaders({ subject: 'ada-scripted' });
    headers.set('content-type', 'application/json');
    headers.set('accept', 'text/event-stream');
    return scripted.fetch(
      new Request(`https://${scripted.domains.acme}/orpc/loans/loanEvents`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ json: {} }),
      }),
    );
  };

  /** The frames, then a source that stays open until its invocation is aborted. */
  const scriptedApp = (frames: readonly unknown[]) =>
    orpcSpyApp([], async function* (invocation) {
      yield* frames as never[];
      await new Promise<void>((resolve) => {
        invocation.signal.addEventListener('abort', () => resolve(), { once: true });
      });
    });

  async function textOf(frames: readonly unknown[]): Promise<string> {
    const scripted = await startTransportRuntime({
      app: scriptedApp(frames),
      host: httpHost(),
      config,
    });
    try {
      return await (await subscribe(scripted)).text();
    } finally {
      await scripted.stop();
    }
  }

  test('a reset with a state carries it as its event id, as the host writes it', async () => {
    const text = await textOf([
      { control: 'head', state: token(1) },
      { control: 'reset', reason: 'overflow', state: token(1) },
    ]);
    const resetEvent = text.split('\n\n').find((block) => block.includes('"reset"'));
    expect(resetEvent).toContain(`id: ${token(1)}`);
  });

  test('a reset without a state, and a gap, carry no event id', async () => {
    const text = await textOf([
      { control: 'head', state: token(1) },
      { control: 'gap', missed: 2 },
      { control: 'reset', reason: 'resync' },
    ]);
    const blocks = text.split('\n\n');
    const gapEvent = blocks.find((block) => block.includes('"gap"'));
    const resetEvent = blocks.find((block) => block.includes('"reset"'));
    expect(gapEvent).toBeDefined();
    expect(resetEvent).toBeDefined();
    expect(gapEvent).not.toContain('id:');
    expect(resetEvent).not.toContain('id:');
  });

  test('a reset ends the response: what the source yields after it never goes out', async () => {
    const text = await textOf([
      { control: 'head', state: token(1) },
      { control: 'reset', reason: 'overflow', state: token(1) },
      {
        event: { loanId: '0192a000-0000-7000-8000-000000000001', kind: 'created' },
        state: token(2),
      },
    ]);
    expect(text).toContain('"reset"');
    expect(text).not.toContain(token(2));
    expect(text).not.toContain('"created"');
  });

  test('a stream that ended at its reset frees its slot', async () => {
    const single = await startTransportRuntime({
      app: scriptedApp([
        { control: 'head', state: token(1) },
        { control: 'reset', reason: 'resync' },
        {
          event: { loanId: '0192a000-0000-7000-8000-000000000001', kind: 'created' },
          state: token(2),
        },
      ]),
      host: httpHost({ live: { maxStreamsPerPrincipal: 1 } }),
      config,
    });
    try {
      const first = await subscribe(single);
      expect(first.status).toBe(200);
      expect(await first.text()).toContain('"reset"');
      const second = await subscribe(single);
      expect(second.status).toBe(200);
      await second.body?.cancel();
    } finally {
      await single.stop();
    }
  });
});
