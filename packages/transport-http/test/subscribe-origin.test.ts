import { afterAll, describe, expect, test, vi } from 'vitest';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000 });

const kit = await startStreamRuntime();
afterAll(() => kit.runtime.stop());

const cookie = '__Host-kw-test=user:ada';
const open = (headers: Record<string, string>) =>
  kit.target.fetch(
    new Request(`${kit.origin}/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D`, {
      headers,
    }),
  );
const code = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

describe('who may open a stream with a cookie', () => {
  test('a cookie GET without Origin is 403 core.csrf', async () => {
    const response = await open({ cookie });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('core.csrf');
  });

  test('an Origin of the tenant, or Sec-Fetch-Site same-origin, opens', async () => {
    const own = await open({ cookie, origin: kit.origin });
    expect(own.status).toBe(200);
    await own.body?.cancel();
    const same = await open({ cookie, 'sec-fetch-site': 'same-origin' });
    expect(same.status).toBe(200);
    await same.body?.cancel();
  });

  test('another site is 403, even with Sec-Fetch-Site cross-site and an Origin it chose', async () => {
    const response = await open({
      cookie,
      origin: 'https://evil.example',
      'sec-fetch-site': 'cross-site',
    });
    expect(response.status).toBe(403);
    expect(await code(response)).toBe('core.csrf');
  });

  test('bearer and ticket requests are exempt', async () => {
    // With a bearer token and no Origin the cookie request would be 403: the origin rule did not apply to it.
    const bearer = await open({ cookie, authorization: 'Bearer unknown' });
    expect(bearer.status).toBe(200);
    await bearer.body?.cancel();
    // A ticket is refused as a ticket, not as a cross-site request.
    const ticket = await kit.target.fetch(
      new Request(
        `${kit.origin}/_keelwerk/v1/subscribe?action=loans.loanEvents&ticket=kwst_aaaaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbb`,
        { headers: { cookie, origin: 'https://evil.example' } },
      ),
    );
    expect(ticket.status).toBe(401);
    expect(await code(ticket)).toBe('core.ticket_invalid');
  });

  test('a websocket upgrade from another site is 403 too', async () => {
    const response = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/live`, {
        headers: { cookie, upgrade: 'websocket', origin: 'https://evil.example' },
      }),
    );
    expect(response.status).toBe(403);
  });
});
