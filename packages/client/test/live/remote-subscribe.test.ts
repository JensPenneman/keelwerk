import { coreApiVersions } from '@keelwerk/core';
import { freshName, startTransportRuntime } from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, it } from 'vitest';
import { createRemoteClient } from '../../src/index.ts';
import type { LiveApp } from '../live-app.ts';
import {
  due,
  fastRetry,
  liveStreamsApp,
  principalHeaders,
  withHeaders,
} from './support/live-fixtures.ts';

/** The newest API version the fixture app serves: it declares none, so the core's. */
const headVersion = coreApiVersions.dates.at(-1) ?? '';
const runtime = await startTransportRuntime({ app: liveStreamsApp, host: httpHost() });
const plain = await startTransportRuntime({ app: transportApp, host: httpHost() });
afterAll(async () => {
  await runtime.stop();
  await plain.stop();
});

const apiVersion = headVersion;
const domain = runtime.domains.acme ?? '';

function clientOver(
  send: (request: Request) => Promise<Response>,
  subject: string,
  origin = `https://${domain}`,
) {
  return createRemoteClient<LiveApp>({
    url: origin,
    apiVersion,
    fetch: withHeaders(send, principalHeaders(subject)),
    retry: fastRetry,
  });
}

function containsInstant(value: unknown): boolean {
  if (value instanceof Temporal.Instant) return true;
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).some(containsInstant);
}

describe('the remote client subscribes over server-sent events', () => {
  it('yields head, then the loan that is created', async () => {
    const ada = freshName('ada');
    const client = clientOver((request) => runtime.fetch(request), ada);
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      await client.invoke('loans.lend', { bookTitle: freshName('Dune'), dueAt: due });
      const item = await frames.next();
      expect(item.value).toMatchObject({
        event: { kind: 'created', loanId: expect.stringMatching(/^[0-9a-f-]{36}$/) },
        state: expect.stringMatching(/^v2\./),
      });
    } finally {
      await frames.return?.();
    }
  });

  it('decodes the rows of the generated watch: dueAt arrives as a Temporal.Instant', async () => {
    const ada = freshName('ada');
    const client = clientOver((request) => runtime.fetch(request), ada);
    const frames = client.subscribe('loans.loan.watch', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      await client.invoke('loans.lend', { bookTitle: freshName('Emma'), dueAt: due });
      let found = false;
      for (let seen = 0; seen < 10 && !found; seen += 1) {
        const step = await frames.next();
        if (step.done === true) break;
        if (!('control' in step.value)) found = containsInstant(step.value.event);
      }
      expect(found).toBe(true);
    } finally {
      await frames.return?.();
    }
  });

  it('resumes after a body cut in the middle of the stream: no loan is lost', async () => {
    const ada = freshName('ada');
    let cut = false;
    let opened = 0;
    const send = async (request: Request): Promise<Response> => {
      const response = await runtime.fetch(request);
      if (!new URL(request.url).pathname.endsWith('/subscribe')) return response;
      opened += 1;
      if (opened > 1 || response.body === null) return response;
      // The first connection delivers what it has up to head and then breaks, as a dropped link does.
      const reader = response.body.getReader();
      let sawHead = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (sawHead) {
            cut = true;
            await reader.cancel().catch(() => undefined);
            controller.error(new TypeError('terminated'));
            return;
          }
          const chunk = await reader.read();
          if (chunk.done) {
            controller.close();
            return;
          }
          if (new TextDecoder().decode(chunk.value).includes('event: head')) sawHead = true;
          controller.enqueue(chunk.value);
        },
      });
      return new Response(body, { status: response.status, headers: response.headers });
    };
    const client = clientOver(send, ada);
    const frames = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    try {
      expect((await frames.next()).value).toMatchObject({ control: 'head' });
      const titles = [freshName('Hamlet'), freshName('Ulysses')];
      for (const bookTitle of titles) await client.invoke('loans.lend', { bookTitle, dueAt: due });
      const created: unknown[] = [];
      while (created.length < 2) {
        const step = await frames.next();
        if (step.done === true) break;
        if (!('control' in step.value)) created.push(step.value.event);
      }
      expect(cut).toBe(true);
      expect(opened).toBeGreaterThan(1);
      expect(created).toHaveLength(2);
      expect(new Set(created.map((event) => (event as { loanId: string }).loanId)).size).toBe(2);
    } finally {
      await frames.return?.();
    }
  });

  it('a v1 token yields reset resync, and the subscription then starts again with head', async () => {
    const ada = freshName('ada');
    const client = clientOver((request) => runtime.fetch(request), ada);
    const first = client.subscribe('loans.loanEvents', {})[Symbol.asyncIterator]();
    const head = (await first.next()).value;
    await first.return?.();
    const state = 'control' in head && head.control === 'head' ? head.state : '';
    const [, epoch, position, scope, check] = state.split('.');
    const old = client
      .subscribe(
        'loans.loanEvents',
        {},
        { after: `v1.${epoch}.${position}.${scope}.${check?.slice(0, 8)}` as never },
      )
      [Symbol.asyncIterator]();
    try {
      expect((await old.next()).value).toMatchObject({ control: 'reset', reason: 'resync' });
      expect((await old.next()).value).toMatchObject({ control: 'head' });
    } finally {
      await old.return?.();
    }
  });

  it('a deployment without the live module rejects with core.live_unavailable', async () => {
    const client = createRemoteClient<LiveApp>({
      url: `https://${plain.domains.acme ?? ''}`,
      apiVersion: plain.headApiVersion,
      fetch: withHeaders((request) => plain.fetch(request), principalHeaders('ada')),
      retry: fastRetry,
    });
    const frames = client
      .subscribe('core.effectStatusWatch' as never, { ids: [] } as never)
      [Symbol.asyncIterator]();
    await expect(frames.next()).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.live_unavailable',
    });
  });
});
