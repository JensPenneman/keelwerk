import {
  type ApiSurface,
  deriveSurface,
  type MountContext,
  type SurfaceAction,
} from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { mountOrpc } from '../src/mount/mount-orpc.ts';
import type { OrpcConfig } from '../src/orpc-config.ts';
import { orpcConformanceApp, orpcConformanceVersions } from './support/orpc-conformance-app.ts';

describe('the response of a call that failed after the procedure ran', () => {
  const failedHeaders = [
    'keelwerk-command-id',
    'idempotent-replayed',
    'keelwerk-effects',
    'deprecation',
    'sunset',
    'link',
    'set-cookie',
    'preference-applied',
  ];
  const head: ApiSurface = deriveSurface(
    orpcConformanceApp as never,
    orpcConformanceVersions.head,
  ).surface;
  /** loans.openDesk, deprecated, with a json member in its output beside the ticket of its cookie. */
  const desk: SurfaceAction = (() => {
    const found = head.actions.find((candidate) => candidate.ref === 'loans.openDesk');
    if (found === undefined) throw new Error('The surface has no loans.openDesk.');
    return {
      ...found,
      deprecated: { reason: 'Use another.', at: '2026-11-05' },
      output: {
        kind: 'shape',
        optional: false,
        access: 'read-write',
        fields: {
          ticket: { kind: 'string', optional: false, access: 'read-write' },
          payload: { kind: 'json', schema: {}, optional: false, access: 'read-write' },
        },
      },
    };
  })();

  /**
   * The answer of the mounted handler to a call of the desk whose invoker succeeds with `value`, or
   * with the `outcome` given; `headers` are sent with the request and put in its carrier, so
   * `prefer` and `idempotency-key` reach the procedure.
   */
  async function called(
    value: unknown,
    options: { outcome?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const surface: ApiSurface = {
      ...head,
      actions: head.actions.map((action) => (action.ref === desk.ref ? desk : action)),
    };
    const routes: { handler: (request: Request, context: never) => Promise<Response> }[] = [];
    const ctx = {
      app: 'orpc-conformance',
      surface,
      invoker: {
        invoke: async () =>
          options.outcome ?? { ok: true, replayed: true, value, effects: ['effect-1'] },
      },
      host: { route: (_spec: unknown, handler: never) => routes.push({ handler }) },
      log: { error: () => undefined },
    } as unknown as MountContext<OrpcConfig>;
    await mountOrpc(ctx, {});
    const route = routes[0];
    if (route === undefined) throw new Error('The transport registered no route.');
    return route.handler(
      new Request('https://acme.example.test/orpc/loans/openDesk', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...options.headers },
        body: JSON.stringify({ json: { desk: 'north' } }),
      }),
      {
        session: {
          apiVersion: surface.apiVersion,
          principal: { kind: 'user' },
          resolvedBy: 'hostname',
        },
        carrier: {
          transport: 'http',
          headers: { 'sec-fetch-site': 'same-origin', ...options.headers },
        },
        requestId: '0192a000-0000-7000-8000-000000000001',
        signal: new AbortController().signal,
        path: '/loans/openDesk',
        basePath: '/orpc',
      } as never,
    );
  }

  test('an output that does not fit its node answers 500 with none of the success headers', async () => {
    const answer = await called({ ticket: 7, payload: {} });
    expect(answer.status).toBe(500);
    for (const name of failedHeaders) expect(answer.headers.get(name)).toBeNull();
  });

  test('an output that oRPC cannot write leaves no session cookie and no success header on its 500', async () => {
    const answer = await called({
      ticket: 'ticket-1',
      payload: Object.defineProperty({}, 'n', {
        enumerable: true,
        get(): never {
          throw new TypeError('output encoding failed (test)');
        },
      }),
    });
    expect(answer.status).toBe(500);
    for (const name of failedHeaders) expect(answer.headers.get(name)).toBeNull();
  });

  test('the receipt of an accepted command that oRPC cannot write answers 500, not 202', async () => {
    const answer = await called(undefined, {
      headers: { prefer: 'respond-async' },
      outcome: {
        ok: true,
        receipt: Object.defineProperty({}, 'n', {
          enumerable: true,
          get(): never {
            throw new TypeError('receipt encoding failed (test)');
          },
        }),
      },
    });
    expect(answer.status).toBe(500);
    expect(answer.headers.get('preference-applied')).toBeNull();
    expect(answer.headers.get('keelwerk-command-id')).toBeNull();
  });

  test('the same call with an output that fits answers 200 with the cookie and the headers', async () => {
    const answer = await called({ ticket: 'ticket-1', payload: { n: 1 } });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('set-cookie')).toContain('__Host-kw-desk=');
    expect(answer.headers.get('idempotent-replayed')).toBe('true');
    expect(answer.headers.get('keelwerk-effects')).toBe('effect-1');
    expect(answer.headers.get('deprecation')).not.toBeNull();
  });
});
