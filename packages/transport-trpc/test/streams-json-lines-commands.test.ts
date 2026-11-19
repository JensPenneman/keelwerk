import { describe, expect, test } from 'vitest';
import {
  envelope,
  mountedTrpc,
  sendTrpc,
  trpcConformanceSurface,
  trpcSurfaceWith,
  trpcUuidOf,
} from './support/trpc-kit.ts';

const lendInput = { bookTitle: 'Dune', dueAt: Temporal.Instant.from('2026-12-01T00:00:00Z') };

describe('a command in a JSON-lines batch', () => {
  const token = {
    kind: 'string',
    optional: false,
    access: 'read-write',
  } as const;
  const signIn = {
    output: {
      kind: 'shape',
      optional: false,
      access: 'read-write',
      fields: { token, name: token },
    },
    hints: {
      http: {
        cookie: { set: { name: '__Host-session', from: 'token' }, omitFromBody: ['token'] },
      },
    },
  };
  const batch = (headers: Record<string, string>) => ({
    method: 'POST',
    search: 'batch=1',
    rawBody: JSON.stringify({ '0': envelope(lendInput) }),
    headers,
    carrierHeaders: { origin: 'https://portal.example' },
  });

  test('a cookie-hinted command over trpc-accept: application/jsonl carries its Set-Cookie', async () => {
    const surface = trpcSurfaceWith(trpcConformanceSurface(), signIn, 'loans.lend');
    const mounted = await mountedTrpc(surface, () => ({
      ok: true,
      value: { token: 'secret-token', name: 'ada' },
    }));
    const response = await sendTrpc(
      mounted.handler,
      'loans.lend',
      batch({ 'trpc-accept': 'application/jsonl' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('__Host-session=secret-token');
    expect(response.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
    const text = await response.text();
    expect(text).toContain('ada');
    expect(text).not.toContain('secret-token');
  });

  test('Prefer: respond-async over JSON lines carries preference-applied and the effects', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({
      ok: true,
      value: undefined,
      receipt: { commandId: trpcUuidOf(5), status: 'accepted' },
      effects: ['effect-a', 'effect-b'],
    }));
    const response = await sendTrpc(
      mounted.handler,
      'loans.lend',
      batch({ 'trpc-accept': 'application/jsonl', prefer: 'respond-async' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('preference-applied')).toBe('respond-async');
    expect(response.headers.get('keelwerk-effects')).toBe('effect-a,effect-b');
    const text = await response.text();
    for (const line of text.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
    expect(text).toContain(trpcUuidOf(5));
    expect(text).toContain('accepted');
  });

  test('two cookie-hinted calls of a JSON-lines batch each keep their own Set-Cookie', async () => {
    const surface = trpcSurfaceWith(trpcConformanceSurface(), signIn, 'loans.lend');
    let issued = 0;
    const mounted = await mountedTrpc(surface, () => {
      issued += 1;
      return { ok: true, value: { token: `token-${issued}`, name: 'ada' } };
    });
    const response = await sendTrpc(mounted.handler, 'loans.lend,loans.lend', {
      method: 'POST',
      search: 'batch=1',
      rawBody: JSON.stringify({ '0': envelope(lendInput), '1': envelope(lendInput) }),
      headers: { 'trpc-accept': 'application/jsonl' },
      carrierHeaders: { origin: 'https://portal.example' },
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.map((cookie) => cookie.split(';')[0]).sort()).toEqual([
      '__Host-session=token-1',
      '__Host-session=token-2',
    ]);
    expect(response.headers.get('keelwerk-command-id')).toBeNull();
    const text = await response.text();
    for (const line of text.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
    expect(text).not.toContain('token-');
  });

  test('a command with no cookie hint carries its command id over JSON lines', async () => {
    const mounted = await mountedTrpc(trpcConformanceSurface(), () => ({
      ok: true,
      value: { loanId: trpcUuidOf(1) },
    }));
    const response = await sendTrpc(
      mounted.handler,
      'loans.lend',
      batch({ accept: 'application/jsonl' }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
  });
});
