import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('errors before the session opens (16.5.3)', () => {
  const unauthenticated = () =>
    createFakeInvoker({
      open: () => ({
        ok: false,
        error: new KeelwerkError({
          kind: 'unauthenticated',
          code: 'core.unauthenticated',
          message: 'bad token',
        }),
      }),
    });
  const big = (path: string) => postJson(path, { action: 'library.echo', input: 'x'.repeat(200) });

  it('answers a 413 body limit on a REST path as a problem document', async () => {
    const { host } = setup({ maxBodyBytes: 64 });
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(big('/api/books'));
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({
      code: 'core.payload_too_large',
      type: 'https://library.example/api/problems/core.payload_too_large',
    });
  });

  it('keeps the envelope for a 413 on the protocol path', async () => {
    const { host } = setup({ maxBodyBytes: 64 });
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(big('/_keelwerk/v1/invoke'));
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'core.payload_too_large' },
    });
  });

  it('answers an invalid bearer on a REST path as a problem document', async () => {
    const { host } = setup({}, unauthenticated());
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(
      new Request('https://library.example/api/books', {
        headers: { authorization: 'Bearer nope' },
      }),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
    expect(await response.json()).toMatchObject({ code: 'core.unauthenticated', status: 401 });
  });

  it('keeps the envelope for an invalid bearer on the protocol path', async () => {
    const { host } = setup({}, unauthenticated());
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => new Response());
    const response = await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { authorization: 'Bearer nope' },
      ),
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'core.unauthenticated' },
    });
  });
});
