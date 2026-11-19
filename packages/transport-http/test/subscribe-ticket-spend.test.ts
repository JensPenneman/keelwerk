import type { LiveFrame } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test, vi } from 'vitest';
import { fakeAction, stringNode } from './support/fake-surface.ts';
import { useTicketKit } from './support/use-ticket-kit.ts';

vi.setConfig({ testTimeout: 60_000 });

const { boot, closers } = useTicketKit();

describe.each(['memory', 'pglite'] as const)(
  'a ticket offered where it is no credential on %s',
  (adapter) => {
    test('a ticket sent to the health or ready probe is 401 and spent at once', async () => {
      const kit = await boot(adapter);
      const health = await kit.issue('ada');
      const ready = await kit.issue('ada', 'loans.loanEvents');
      for (const [path, ticket] of [
        ['health', health],
        ['ready', ready],
      ] as const) {
        const probe = await kit.target.fetch(
          new Request(`${kit.origin}/_keelwerk/${path}?ticket=${ticket}`),
        );
        expect(probe.status).toBe(401);
        expect(((await probe.json()) as { error: { code: string } }).error.code).toBe(
          'core.ticket_invalid',
        );
      }
      expect((await kit.open(health)).status).toBe(401);
      expect((await kit.open(ready)).status).toBe(401);
      // A probe without a ticket answers as ever.
      const plain = await kit.target.fetch(new Request(`${kit.origin}/_keelwerk/health`));
      expect(plain.status).toBe(200);
    });

    test('a ticket sent to a REST mount path is spent at once and the request answers as without it', async () => {
      const kit = await boot(adapter);
      kit.runtime.runtime.host?.route(
        { app: 'streams', transport: 'rest', prefix: '/api' },
        async () => new Response('mounted', { status: 200 }),
      );
      const onGet = await kit.issue('ada');
      const onPost = await kit.issue('ada', 'loans.loanEvents');
      const plain = await kit.target.fetch(new Request(`${kit.origin}/api/books`));
      const withTicket = await kit.target.fetch(
        new Request(`${kit.origin}/api/books?ticket=${onGet}`),
      );
      const posted = await kit.target.fetch(
        new Request(`${kit.origin}/api/books?ticket=${onPost}`, { method: 'POST', body: '{}' }),
      );
      for (const response of [withTicket, posted]) {
        expect(response.status).toBe(plain.status);
        expect(await response.text()).toBe('mounted');
      }
      // Neither ticket is any use afterwards on the endpoint it was made for.
      for (const ticket of [onGet, onPost]) {
        const again = await kit.open(ticket);
        expect(again.status).toBe(401);
        expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
          'core.ticket_invalid',
        );
      }
    });

    test('a ticket sent to a mounted route that streams is spent at once and the stream answers as without it', async () => {
      const kit = await boot(adapter);
      const action = fakeAction('loans.loanEvents', { kind: 'subscription', output: stringNode });
      kit.runtime.runtime.host?.route(
        { app: 'streams', transport: 'rest', prefix: '/api' },
        async (_request, ctx) => {
          async function* frames(): AsyncGenerator<LiveFrame<unknown>> {
            yield { event: 'one' };
            await new Promise<void>(() => undefined);
          }
          return (
            ctx.serveStream?.(frames(), { action, surfaceHash: 'hash-1' }) ?? new Response(null)
          );
        },
      );
      const ticket = await kit.issue('ada', 'loans.loanEvents');
      const response = await kit.target.fetch(
        new Request(`${kit.origin}/api/books?ticket=${ticket}`, {
          headers: { accept: 'text/event-stream' },
        }),
      );
      expect(response.status).toBe(200);
      const stream = readEventStream(response);
      closers.push(() => stream.close());
      expect(await stream.next()).toMatchObject({
        event: 'welcome',
        data: { surfaceHash: 'hash-1' },
      });
      expect(await stream.next()).toMatchObject({ event: 'data', data: 'one' });
      await stream.close();
      // The ticket was spent with the request that carried it to the wrong place.
      const again = await kit.open(ticket);
      expect(again.status).toBe(401);
      expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
        'core.ticket_invalid',
      );
    });

    test('a value that is no ticket on a mount path is no credential and the request goes on', async () => {
      const kit = await boot(adapter);
      kit.runtime.runtime.host?.route(
        { app: 'streams', transport: 'rest', prefix: '/api' },
        async () => new Response('mounted', { status: 200 }),
      );
      for (const value of ['Not-A-Ticket!', 'abc_def', 'kwst_short_short']) {
        const response = await kit.target.fetch(
          new Request(`${kit.origin}/api/books?ticket=${value}`),
        );
        expect(response.status).toBe(200);
      }
    });
  },
);
