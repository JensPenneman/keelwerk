import { describe, expect, test } from 'vitest';
import { actionOf, invokerOf, registryOf, sessionOf } from '../../test/invoker/invoker-kit.ts';

const invoker = invokerOf(registryOf([actionOf('doc.open', { auth: 'public' })]));
const renewing = { authorization: 'Bearer tok-ada', 'x-renew': '1' };

describe("renewCookie becomes the session's setCookies", () => {
  test('a browser request under host-based resolution gets the cookie with the new expiry', async () => {
    const session = sessionOf(
      await invoker.open({
        transport: 'test',
        host: 'doc.example',
        headers: { ...renewing, origin: 'https://doc.example' },
      }),
    );
    expect(session.resolvedBy).toBe('hostname');
    expect(session.setCookies).toHaveLength(1);
    expect(session.setCookies?.[0]).toContain('__Host-sid=tok-ada;');
    expect(session.setCookies?.[0]).toContain('Expires=Wed, 04 Nov 2026 06:00:00 GMT');
    expect(session.setCookies?.[0]).toContain('Max-Age=21600');
  });

  test('a request that is no browser request gets none', async () => {
    const session = sessionOf(
      await invoker.open({ transport: 'test', host: 'doc.example', headers: renewing }),
    );
    expect(session.setCookies).toBeUndefined();
  });

  test('a browser request whose tenant is not resolved by host name gets none', async () => {
    const session = sessionOf(
      await invoker.open({
        transport: 'test',
        headers: { ...renewing, 'x-tenant': 't1', origin: 'https://doc.example' },
      }),
    );
    expect(session.resolvedBy).toBe('header');
    expect(session.setCookies).toBeUndefined();
  });
});
