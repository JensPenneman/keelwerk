import { AppNotServedError, KeelwerkError, type Logger } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { fakeSession } from './support/fake-session.ts';
import { fakeAction, fakeSurface, stringNode } from './support/fake-surface.ts';
import { libraryActions } from './support/library-actions.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('statuses and the error envelope', () => {
  const cases: [string, ConstructorParameters<typeof KeelwerkError>[0], number][] = [
    ['validation', { kind: 'validation', code: 'x.bad', message: 'm' }, 422],
    ['malformed', { kind: 'validation', code: 'core.malformed_request', message: 'm' }, 400],
    ['too large', { kind: 'validation', code: 'core.payload_too_large', message: 'm' }, 413],
    [
      'unauthenticated',
      { kind: 'unauthenticated', code: 'core.unauthenticated', message: 'm' },
      401,
    ],
    ['forbidden', { kind: 'forbidden', code: 'core.forbidden', message: 'm' }, 403],
    ['not found', { kind: 'not_found', code: 'core.not_found', message: 'm' }, 404],
    ['retired', { kind: 'not_found', code: 'core.api_version_retired', message: 'm' }, 410],
    ['conflict', { kind: 'conflict', code: 'x.taken', message: 'm' }, 409],
    ['version mismatch', { kind: 'conflict', code: 'core.version_mismatch', message: 'm' }, 412],
    [
      'idempotency mismatch',
      { kind: 'conflict', code: 'core.idempotency_mismatch', message: 'm' },
      422,
    ],
    [
      'rate limited',
      { kind: 'rate_limited', code: 'core.rate_limited', message: 'm', retryAfter: 3 },
      429,
    ],
    [
      'not implemented',
      { kind: 'not_implemented', code: 'core.not_implemented', message: 'm' },
      501,
    ],
    [
      'unavailable',
      { kind: 'unavailable', code: 'core.unavailable', message: 'm', retryAfter: 2 },
      503,
    ],
    ['unsupported', { kind: 'unsupported', code: 'core.unsupported', message: 'm' }, 422],
    ['internal', { kind: 'internal', code: 'core.internal', message: 'secret detail' }, 500],
  ];

  it.each(cases)('maps %s', async (_name, init, status) => {
    const invoker = createFakeInvoker({
      actions: { 'library.fail': () => ({ ok: false, error: new KeelwerkError(init) }) },
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.fail' }));
    expect(response.status).toBe(status);
    const body = (await response.json()) as { ok: false; error: Record<string, unknown> };
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe(init.kind);
    expect(body.error.requestId).toBe(response.headers.get('x-request-id'));
    if (init.kind === 'rate_limited' || init.kind === 'unavailable') {
      expect(response.headers.get('retry-after')).toBe(String(init.retryAfter));
    }
    if (status === 401) {
      expect(response.headers.get('www-authenticate')).toMatch(/^Bearer/);
    }
    if (init.kind === 'internal') {
      expect(body.error.message).toBe('Internal server error.');
    }
  });

  it('shows an operator the unredacted internal message', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: true,
        value: fakeSession({
          principal: { ...fakeSession().principal, kind: 'operator', id: 'op' },
        }),
      }),
      actions: {
        'library.fail': () => ({
          ok: false,
          error: new KeelwerkError({
            kind: 'internal',
            code: 'core.internal',
            message: 'secret detail',
          }),
        }),
      },
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.fail' }));
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      'secret detail',
    );
  });

  it('turns a thrown error into a redacted internal answer', async () => {
    const { host } = setup({}, createFakeInvoker({ actions: {} }));
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.unknown' }),
    );
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('no fake action');
  });

  it('answers a failed open with the error and echoes the requested version', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: false,
        error: new KeelwerkError({
          kind: 'unauthenticated',
          code: 'core.unauthenticated',
          message: 'bad token',
        }),
      }),
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { 'keelwerk-version': '2026-01-01' },
      ),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('keelwerk-version')).toBe('2026-01-01');
  });

  it('rejects malformed bodies with 400', async () => {
    const { host } = setup();
    for (const body of ['{', '[]', '{"action":3}', '{"action":"a","prefer":"later"}']) {
      const response = await host.fetch(postJson('/_keelwerk/v1/invoke', body));
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'core.malformed_request',
      );
    }
  });

  it('answers 405 for a wrong method and 404 for an unknown endpoint', async () => {
    const { host } = setup();
    const wrong = await host.fetch(new Request('https://library.example/_keelwerk/v1/invoke'));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
    const unknown = await host.fetch(postJson('/_keelwerk/v1/subscribe', {}));
    expect(unknown.status).toBe(404);
  });

  it('adds deprecation headers at a deprecated version', async () => {
    const invoker = createFakeInvoker({
      open: () => ({
        ok: true,
        value: fakeSession({
          deprecation: { at: '2026-11-01T00:00:00Z', sunset: '2027-11-01T00:00:00Z' },
        }),
      }),
      actions: libraryActions,
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    expect(response.headers.get('deprecation')).toBe(
      `@${Date.parse('2026-11-01T00:00:00Z') / 1000}`,
    );
    expect(response.headers.get('sunset')).toBe('Mon, 01 Nov 2027 00:00:00 GMT');
    expect(response.headers.get('link')).toContain('rel="deprecation"');
  });
});

describe('deprecated action and reserved prefix', () => {
  it('adds deprecation headers for a deprecated action', async () => {
    const surface = fakeSurface([
      fakeAction('library.old', {
        output: stringNode,
        deprecated: { reason: 'gone', at: '2026-11-01T00:00:00Z', sunset: '2027-11-01T00:00:00Z' },
      }),
    ]);
    const invoker = createFakeInvoker({
      actions: { ...libraryActions, 'library.old': () => ({ ok: true, value: 'old' }) },
    });
    const { host } = setup({}, invoker, { surface: () => surface });
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.old' }));
    expect(response.headers.get('deprecation')).toBe(
      `@${Date.parse('2026-11-01T00:00:00Z') / 1000}`,
    );
    expect(response.headers.get('sunset')).toBe('Mon, 01 Nov 2027 00:00:00 GMT');
    expect(response.headers.get('link')).toContain('rel="deprecation"');
  });

  it('answers not_found for any other /_keelwerk path, even with a / mount', async () => {
    const { host } = setup();
    host.route({ app: 'library', transport: 'ui', prefix: '/' }, async () => new Response('ui'));
    const response = await host.fetch(postJson('/_keelwerk/v2/invoke', {}));
    expect(response.status).toBe(404);
  });
});

describe('body limit', () => {
  it('answers 413 core.payload_too_large above the limit, declared or streamed', async () => {
    const { host, invoker } = setup({ maxBodyBytes: 64 });
    const declared = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.echo', input: 'x'.repeat(100) }),
    );
    expect(declared.status).toBe(413);
    expect(((await declared.json()) as { error: { code: string } }).error.code).toBe(
      'core.payload_too_large',
    );
    const streamed = await host.fetch(
      new Request('https://library.example/_keelwerk/v1/invoke', {
        method: 'POST',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('x'.repeat(100)));
            controller.close();
          },
        }),
        duplex: 'half',
      }),
    );
    expect(streamed.status).toBe(413);
    expect(invoker.opened).toHaveLength(0);
  });

  it('accepts a body at the limit', async () => {
    const body = JSON.stringify({ action: 'library.lookup' });
    const { host } = setup({ maxBodyBytes: body.length });
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', body));
    expect(response.status).toBe(200);
  });
});

describe('a surface that cannot be derived for the session', () => {
  const recorded = (): { lines: [string, Record<string, unknown>][]; log: Logger } => {
    const lines: [string, Record<string, unknown>][] = [];
    const log: Logger = {
      debug() {},
      info() {},
      warn() {},
      error: (message, fields) => lines.push([message, { ...fields }]),
      child: (bindings) => ({
        ...log,
        error: (message, fields) => lines.push([message, { ...bindings, ...fields }]),
      }),
    };
    return { lines, log };
  };
  const failing = (): never => {
    throw new RangeError('Version 2026-01-01 is not among the declared versions.');
  };

  it('answers 500 and logs it once, never an answer without its wire encoding', async () => {
    const { lines, log } = recorded();
    const invoker = createFakeInvoker({
      actions: { 'library.echo': () => ({ ok: true, value: 'raw' }) },
    });
    const { host } = setup({}, invoker, { surface: failing, log });
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    expect(response.status).toBe(500);
    expect(invoker.invoked).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]).toBe('request failed');
    expect(lines[0]?.[1]).toMatchObject({
      requestId: response.headers.get('x-request-id'),
      cause: 'Version 2026-01-01 is not among the declared versions.',
    });
  });

  it('answers a batch the same way: 500, nothing invoked, one line in the log', async () => {
    const { lines, log } = recorded();
    const invoker = createFakeInvoker({
      actions: { 'library.echo': () => ({ ok: true, value: 'raw' }) },
    });
    const { host } = setup({}, invoker, { surface: failing, log });
    const response = await host.fetch(
      postJson('/_keelwerk/v1/batch', { invocations: [{ action: 'library.echo' }] }),
    );
    expect(response.status).toBe(500);
    expect(invoker.invoked).toHaveLength(0);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[0]).toBe('request failed');
    expect(lines[0]?.[1]).toMatchObject({ requestId: response.headers.get('x-request-id') });
  });

  it('still hands an app the process does not serve to the invoker', async () => {
    const invoker = createFakeInvoker({
      actions: { 'library.echo': () => ({ ok: true, value: 'raw' }) },
    });
    const notServed = (): never => {
      throw new AppNotServedError('library');
    };
    const { host } = setup({}, invoker, { surface: notServed });
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    expect(response.status).toBe(200);
  });

  it('hands a look-alike made by another copy of the core to the invoker too', async () => {
    const invoker = createFakeInvoker({
      actions: { 'library.echo': () => ({ ok: true, value: 'raw' }) },
    });
    const lookAlike = Object.assign(new RangeError('not served'), {
      name: 'AppNotServedError',
      appId: 'library',
    });
    expect(lookAlike).not.toBeInstanceOf(AppNotServedError);
    const notServed = (): never => {
      throw lookAlike;
    };
    const { host } = setup({}, invoker, { surface: notServed });
    const response = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.echo' }));
    expect(response.status).toBe(200);
  });
});
