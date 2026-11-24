import { KeelwerkError, type LiveFrame } from '@keelwerk/core';
import { readEventStream } from '@keelwerk/testing';
import { describe, expect, test } from 'vitest';
import { fakeAction, stringNode } from './support/fake-surface.ts';
import { streamApp } from './support/stream-runtime.ts';
import { useTicketKit } from './support/use-ticket-kit.ts';

const { boot, closers } = useTicketKit();

/**
 * The stream app with a second principal resolver, a session store that is down whenever a request
 * carries the header `x-store-down`: it throws an internal error, which a ticket's request keeps.
 */
const unstableSessions: typeof streamApp = {
  ...streamApp,
  registry: {
    ...streamApp.registry,
    fills: new Map([
      ...streamApp.registry.fills,
      [
        'core.principalResolvers',
        [
          ...(streamApp.registry.fills.get('core.principalResolvers') ?? []),
          {
            point: 'core.principalResolvers',
            module: 'core',
            bound: false,
            fill: {
              id: 'flaky.sessions',
              describe: () => ({ scheme: 'apiKey' }),
              // biome-ignore lint/correctness/useYield: a resolver is a generator by contract; this one asks for nothing
              *resolve(carrier: { readonly headers?: Readonly<Record<string, string>> }) {
                if (carrier.headers?.['x-store-down'] === undefined) return null;
                throw new KeelwerkError({
                  kind: 'internal',
                  code: 'core.internal',
                  message: 'The session store is down.',
                });
              },
            },
          },
        ],
      ],
    ]),
  },
};

const codeOf = async (response: Response): Promise<string> =>
  ((await response.json()) as { error: { code: string } }).error.code;

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

    test('a ticket offered for another action while another resolver fails is spent, not left redeemable', async () => {
      const kit = await boot(adapter, undefined, unstableSessions);
      const ticket = await kit.issue('ada', 'loans.loanEvents');
      // The binding mismatch is dropped as a client error and the store's internal error is kept: the
      // open fails with 500, and the ticket in the logged URL must be dead all the same.
      const wrong = await kit.open(ticket, { 'x-store-down': '1' }, 'loans.loanTicker');
      expect(wrong.status).toBe(500);
      expect(await codeOf(wrong)).toBe('core.internal');
      const own = await kit.open(ticket);
      expect(own.status).toBe(401);
      expect(await codeOf(own)).toBe('core.ticket_invalid');
    });

    test('a correct ticket still opens while another resolver fails, and a correct one without the failure opens', async () => {
      const kit = await boot(adapter, undefined, unstableSessions);
      const withFailure = await kit.issue('ada', 'loans.loanEvents');
      const failing = await kit.open(withFailure, { 'x-store-down': '1' });
      expect(failing.status).toBe(200);
      closers.push(async () => void (await failing.body?.cancel()));
      const control = await kit.issue('ada', 'loans.loanEvents');
      const plain = await kit.open(control);
      expect(plain.status).toBe(200);
      closers.push(async () => void (await plain.body?.cancel()));
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
