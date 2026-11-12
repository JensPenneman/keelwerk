import { defineApp } from '@keelwerk/core';
import { live } from '@keelwerk/live';
import { httpHost } from '@keelwerk/transport-http';
import { rest } from '@keelwerk/transport-rest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { dueAt } from '../src/conformance/transport/due-at.ts';
import { freshName } from '../src/conformance/transport/fresh-name.ts';
import { readEventStream } from '../src/conformance/transport/read-event-stream.ts';
import { startTransportRuntime } from '../src/conformance/transport/start-transport-runtime.ts';
import { library, loans } from '../src/fixtures/index.ts';
import { startTestRuntime } from '../src/harness/start-test-runtime.ts';
import { testPrincipalHeader } from '../src/harness/test-principal-header.ts';
import type { TestRuntime } from '../src/harness/test-runtime.ts';
import { fakeTransport } from './support/fake-transport.ts';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const hosted = defineApp({ id: 'hosted', modules: [live, library, loans, rest, fakeTransport] });
const url = 'https://hosted.example.test';
const inRange = /^198\.(18|19)\.\d{1,3}\.\d{1,3}$/;

describe.each(['memory', 'pglite'] as const)(
  'a test runtime that hosts transports on %s',
  (adapter) => {
    let started: TestRuntime<typeof hosted>;
    beforeAll(async () => {
      started = await startTestRuntime(hosted, {
        adapter,
        host: httpHost(),
        config: { rest: { docs: false, cors: [] } },
      });
    });
    afterAll(() => started.stop());

    const send = async (
      path: string,
      init: { method?: string; body?: unknown; subject?: string } = {},
      remoteAddress?: string,
      headers: Record<string, string> = {},
    ) => {
      const runtime = started;
      const request = new Request(`${url}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          'content-type': 'application/json',
          ...headers,
          'x-tenant': runtime.tenants.acme?.id ?? '',
          [testPrincipalHeader]: JSON.stringify({
            subject: init.subject ?? 'ada',
            roles: [],
            claims: {},
          }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
      return runtime.fetch(request, remoteAddress === undefined ? undefined : { remoteAddress });
    };
    const lend = (title: string) => ({ bookTitle: title, dueAt });

    it('one app answers through REST, the invocation protocol and a fourth transport', async () => {
      const titles = [freshName('Dune'), freshName('Emma'), freshName('Ulysses')];
      const answers = [
        await send('/api/loans/lend', { body: lend(titles[0] ?? '') }),
        await send('/_keelwerk/v1/invoke', {
          body: { action: 'loans.lend', input: lend(titles[1] ?? '') },
        }),
        await send('/fake/loans.lend', { body: lend(titles[2] ?? '') }),
      ];
      const ids: string[] = [];
      for (const [index, answer] of answers.entries()) {
        expect(answer.status, `transport ${index}`).toBeGreaterThanOrEqual(200);
        expect(answer.status).toBeLessThan(300);
        const body = (await answer.json()) as { loanId?: string; value?: { loanId?: string } };
        ids.push(body.loanId ?? body.value?.loanId ?? '');
      }
      // The fake transport hands the invoker's value on as it is, so its loan id is the stored form.
      expect(ids.every((id) => id !== '')).toBe(true);
      expect(new Set(ids).size).toBe(3);
    });

    it("a subscription on the protocol's endpoint sees the writes of all three transports", async () => {
      const stream = readEventStream(
        await send('/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D'),
      );
      try {
        expect((await stream.next())?.event).toBe('welcome');
        expect((await stream.next())?.event).toBe('head');
        await send('/api/loans/lend', { body: lend(freshName('Dune')) });
        await send('/_keelwerk/v1/invoke', {
          body: { action: 'loans.lend', input: lend(freshName('Emma')) },
        });
        await send('/fake/loans.lend', { body: lend(freshName('Ulysses')) });
        for (let seen = 0; seen < 3; seen += 1) {
          expect((await stream.next())?.event).toBe('data');
        }
      } finally {
        await stream.close();
      }
    });

    it('each request comes from its own client address, and remoteAddress names one', async () => {
      const first = (await (await send('/fake/address')).json()) as { address: string };
      const second = (await (await send('/fake/address')).json()) as { address: string };
      expect(first.address).toMatch(inRange);
      expect(second.address).toMatch(inRange);
      expect(first.address).not.toBe(second.address);
      const named = (await (await send('/fake/address', {}, '203.0.113.7')).json()) as {
        address: string;
      };
      expect(named.address).toBe('203.0.113.7');
      const forwarded = (await (
        await send('/fake/address', {}, undefined, { 'x-forwarded-for': '203.0.113.9' })
      ).json()) as { address: string };
      expect(forwarded.address).toMatch(inRange);
      expect(forwarded.address).not.toBe('203.0.113.9');
    });
  },
);

describe('the client address on the in-memory adapter', () => {
  it('ignores a forwarding header a client sends when the deployment names no trusted proxy', async () => {
    const t = await startTransportRuntime({ app: hosted, host: httpHost() });
    const listening = await startTransportRuntime({
      app: hosted,
      host: httpHost({ listen: { port: 0 } }),
    });
    const trusting = await startTransportRuntime({
      app: hosted,
      host: httpHost({ listen: { port: 0 }, trustedProxies: ['127.0.0.1'] }),
    });
    try {
      const forwarded = { 'x-forwarded-for': '203.0.113.9' };
      const inProcess = await t.fetch(
        new Request(`${url}/fake/address`, {
          headers: { ...forwarded, 'x-tenant': t.tenants.acme ?? '' },
        }),
      );
      expect(((await inProcess.json()) as { address: string }).address).toMatch(inRange);
      const overSocket = async (runtime: typeof listening) => {
        const response = await fetch(`http://127.0.0.1:${runtime.runtime.port}/fake/address`, {
          headers: { ...forwarded, 'x-tenant': runtime.tenants.acme ?? '' },
        });
        return ((await response.json()) as { address: string }).address;
      };
      expect(await overSocket(listening)).toBe('127.0.0.1');
      expect(await overSocket(trusting)).toBe('203.0.113.9');
    } finally {
      await Promise.all([t.stop(), listening.stop(), trusting.stop()]);
    }
  });

  it('refuses fetch of a test runtime started without host', async () => {
    const runtime = await startTestRuntime(defineApp({ id: 'plain', modules: [library, loans] }));
    try {
      await expect(runtime.fetch(new Request(`${url}/`))).rejects.toThrow(TypeError);
    } finally {
      await runtime.stop();
    }
  });
});
