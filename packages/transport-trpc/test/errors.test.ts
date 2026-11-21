import { type ErrorKind, errors, KeelwerkError } from '@keelwerk/core';
import { TRPCError } from '@trpc/server';
import { describe, expect, test } from 'vitest';
import { keelwerkErrorOfTrpc } from '../src/errors/keelwerk-error-of-trpc.ts';
import { trpcCodeOf } from '../src/errors/trpc-code-of.ts';
import {
  mountedTrpc,
  mutateTrpc,
  queryTrpc,
  sendTrpc,
  trpcConformanceSurface,
  trpcRequestId,
  trpcSession,
} from './support/trpc-kit.ts';

// The tRPC column of section 16.4.6 with the HTTP status tRPC derives from it.
const kinds: readonly (readonly [ErrorKind, string, number])[] = [
  ['validation', 'BAD_REQUEST', 400],
  ['unauthenticated', 'UNAUTHORIZED', 401],
  ['forbidden', 'FORBIDDEN', 403],
  ['not_found', 'NOT_FOUND', 404],
  ['conflict', 'CONFLICT', 409],
  ['rate_limited', 'TOO_MANY_REQUESTS', 429],
  ['not_implemented', 'NOT_IMPLEMENTED', 501],
  ['unavailable', 'SERVICE_UNAVAILABLE', 503],
  ['unsupported', 'UNPROCESSABLE_CONTENT', 422],
  ['internal', 'INTERNAL_SERVER_ERROR', 500],
];

const failing = (error: KeelwerkError) => () => ({ ok: false as const, error });

describe('the tRPC code of an error', () => {
  test.each(kinds)('%s is %s with status %i', async (kind, code, status) => {
    expect(trpcCodeOf({ kind, code: `core.${kind}` })).toBe(code);
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      failing(new KeelwerkError({ kind, code: `core.${kind}`, message: 'It failed.' })),
    );
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(answer.status).toBe(status);
    expect(answer.body.error.json.data.code).toBe(code);
    expect(answer.body.error.json.data.keelwerk).toMatchObject({ kind, code: `core.${kind}` });
  });

  test('PAYLOAD_TOO_LARGE with status 413 for a body over the bound, though its kind is validation', async () => {
    const error = new KeelwerkError({
      kind: 'validation',
      code: 'core.payload_too_large',
      message: 'Too large.',
    });
    expect(trpcCodeOf(error)).toBe('PAYLOAD_TOO_LARGE');
    const mounted = await mountedTrpc(trpcConformanceSurface(), failing(error));
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(answer.status).toBe(413);
    expect(answer.body.error.json.data.code).toBe('PAYLOAD_TOO_LARGE');
  });

  test('PRECONDITION_FAILED for a stale ifVersion', async () => {
    for (const code of ['core.version_mismatch', 'core.state_mismatch']) {
      expect(trpcCodeOf({ kind: 'conflict', code })).toBe('PRECONDITION_FAILED');
    }
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      failing(
        new KeelwerkError({ kind: 'conflict', code: 'core.version_mismatch', message: 'Stale.' }),
      ),
    );
    const answer = await mutateTrpc(mounted.handler, 'loans.lend', {
      bookTitle: 'Dune',
      dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z'),
    });
    expect(answer.status).toBe(412);
    expect(answer.body.error.json.data.code).toBe('PRECONDITION_FAILED');
  });

  test('data.keelwerk is the wire error with the request id', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      failing(
        new KeelwerkError({
          kind: 'validation',
          code: 'core.validation',
          message: 'Wrong.',
          issues: [{ path: ['bookTitle'], message: 'Too long.' }],
        }),
      ),
    );
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(answer.body.error.json.data.keelwerk).toEqual({
      kind: 'validation',
      code: 'core.validation',
      message: 'Wrong.',
      retryable: false,
      issues: [{ path: ['bookTitle'], message: 'Too long.' }],
      requestId: trpcRequestId,
    });
    expect(answer.body.error.json.message).toBe('Wrong.');
  });

  test('an internal error answers the taxonomy title only and is logged once', async () => {
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      failing(errors.internal('the database password is hunter2', { cause: new Error('boom') })),
    );
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toContain('hunter2');
    expect(answer.body.error.json.data.keelwerk.message).toBe('Internal server error.');
    const logged = mounted.lines.filter((line) => line.level === 'error');
    expect(logged).toHaveLength(1);
    expect(logged[0]?.fields).toMatchObject({ requestId: trpcRequestId, code: 'core.internal' });
  });

  test('a value the invoker throws is an internal error that keeps its message to itself', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => {
      throw new Error('secret detail');
    });
    const answer = await queryTrpc(mounted.handler, 'loans.about', {});
    expect(answer.status).toBe(500);
    expect(JSON.stringify(answer.body)).not.toContain('secret detail');
  });

  test('the operator audience sees the detail of an internal error', async () => {
    const operator = trpcSession({
      principal: {
        kind: 'operator',
        id: 'op1',
        scope: { backend: null, tenant: null },
        claims: {},
        roles: [],
        memberships: [],
        via: 'none',
        ref: null,
      },
    });
    const mounted = await mountedTrpc(
      trpcConformanceSurface(),
      failing(errors.internal('the detail')),
    );
    const answer = await queryTrpc(mounted.handler, 'loans.about', {}, { session: operator });
    expect(answer.body.error.json.data.keelwerk.message).toBe('the detail');
  });

  test("tRPC's own errors carry data.keelwerk", async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), failing(errors.internal('x')));
    const unknown = await queryTrpc(mounted.handler, 'loans.nothing', {});
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.json.data.keelwerk).toMatchObject({
      kind: 'not_found',
      code: 'core.not_found',
      requestId: trpcRequestId,
    });
    const bad = await sendTrpc(mounted.handler, 'loans.lend', {
      method: 'POST',
      rawBody: '{not json',
    });
    expect(bad.status).toBe(400);
    expect(
      ((await bad.json()) as { error: { json: { data: { keelwerk: unknown } } } }).error.json.data
        .keelwerk,
    ).toMatchObject({
      kind: 'validation',
      code: 'core.malformed_request',
    });
  });
});

describe('the taxonomy error behind a TRPCError', () => {
  test('the cause wins, tRPC codes map to core codes and anything else is internal', () => {
    const cause = errors.forbidden('no');
    expect(keelwerkErrorOfTrpc(new TRPCError({ code: 'FORBIDDEN', cause }))).toBe(cause);
    const code = (trpc: ConstructorParameters<typeof TRPCError>[0]['code']) =>
      keelwerkErrorOfTrpc(new TRPCError({ code: trpc })).code;
    expect(code('PARSE_ERROR')).toBe('core.malformed_request');
    expect(code('BAD_REQUEST')).toBe('core.malformed_request');
    expect(code('NOT_FOUND')).toBe('core.not_found');
    expect(code('METHOD_NOT_SUPPORTED')).toBe('core.unsupported');
    expect(code('UNSUPPORTED_MEDIA_TYPE')).toBe('core.unsupported');
    expect(code('PAYLOAD_TOO_LARGE')).toBe('core.payload_too_large');
    const internal = keelwerkErrorOfTrpc(new TRPCError({ code: 'TIMEOUT', message: 'private' }));
    expect(internal).toMatchObject({ kind: 'internal' });
    expect(internal.message).not.toContain('private');
  });
});
