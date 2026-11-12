import type { InvocationSession } from '@keelwerk/core';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { connectLiveSocket } from './support/connect-live-socket.ts';
import { fakeSession } from './support/fake-session.ts';
import type { LiveSocketClient } from './support/live-socket-client.ts';
import { type SocketHost, socketHost } from './support/socket-host.ts';
import { startStreamRuntime } from './support/stream-runtime.ts';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const kit = await startStreamRuntime({ listen: { port: 0 } });
afterAll(() => kit.runtime.stop());
const port = kit.runtime.runtime.port ?? 0;
const domain = Object.values(kit.runtime.domains)[0] ?? '';
const cookie = '__Host-kw-test=user:ada';

const upgrade = (headers: Record<string, string>, protocols?: readonly string[]) =>
  connectLiveSocket(port, domain, headers, protocols);

function refused(result: Awaited<ReturnType<typeof upgrade>>) {
  if ('socket' in result) throw new Error('the upgrade was accepted');
  return result;
}

describe('who may open a socket with a cookie (L1)', () => {
  test('a cookie upgrade without Origin or Sec-Fetch-Site is 403 core.csrf before accept', async () => {
    const result = refused(await upgrade({ cookie }));
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ ok: false, error: { code: 'core.csrf' } });
  });

  test('a foreign Origin with the cookie is 403, also with Sec-Fetch-Site cross-site', async () => {
    const foreign = refused(await upgrade({ cookie, origin: 'https://evil.example' }));
    expect(foreign.status).toBe(403);
    const cross = refused(
      await upgrade({
        cookie,
        origin: 'https://evil.example',
        'sec-fetch-site': 'cross-site',
      }),
    );
    expect(cross.status).toBe(403);
    expect(cross.body).toMatchObject({ error: { code: 'core.csrf' } });
  });

  test('the tenant’s Origin, or Sec-Fetch-Site same-origin, opens with the cookie', async () => {
    for (const headers of [
      { cookie, origin: kit.origin },
      { cookie, 'sec-fetch-site': 'same-origin' },
    ]) {
      const client = await upgrade(headers);
      if (!('socket' in client)) throw new Error(`refused with ${client.status}`);
      client.send({ type: 'hello' });
      expect(await client.next()).toMatchObject({ type: 'welcome' });
      await client.close();
    }
  });

  test('a ticket in the upgrade query is 401 core.ticket_invalid and is spent', async () => {
    const issued = await kit.target.fetch(
      new Request(`${kit.origin}/_keelwerk/v1/invoke`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
        },
        body: JSON.stringify({ action: 'live.ticket', input: { action: 'loans.loanEvents' } }),
      }),
    );
    const { value } = (await issued.json()) as { value: { ticket: string } };
    const result = refused(
      await connectLiveSocket(port, domain, {}, undefined, { query: `?ticket=${value.ticket}` }),
    );
    expect(result.status).toBe(401);
    expect(result.body).toMatchObject({ error: { code: 'core.ticket_invalid' } });
    const again = await kit.target.fetch(
      new Request(
        `${kit.origin}/_keelwerk/v1/subscribe?action=loans.loanEvents&input=%7B%7D&ticket=${value.ticket}`,
      ),
    );
    expect(again.status).toBe(401);
    expect(await again.json()).toMatchObject({ error: { code: 'core.ticket_invalid' } });
  });

  test('an upgrade offering no keelwerk.live.v1 is refused; a plain GET of /_keelwerk/v1/live is core.unsupported', async () => {
    const other = refused(await upgrade({}, ['other.v1']));
    expect(other.status).toBe(422);
    expect(other.body).toMatchObject({ error: { code: 'core.unsupported' } });
    const none = refused(await upgrade({}, []));
    expect(none.status).toBe(422);
    const plain = await kit.target.fetch(new Request(`${kit.origin}/_keelwerk/v1/live`));
    expect(plain.status).toBe(422);
    expect(await plain.json()).toMatchObject({ error: { code: 'core.unsupported' } });
  });
});

describe('credentials of the hello', () => {
  const hosts: SocketHost[] = [];
  afterEach(async () => {
    await Promise.all(hosts.splice(0).map((made) => made.host.stop(100)));
  });
  const tenantTwo: InvocationSession = fakeSession({
    scope: { level: 'tenant', backendId: 'b1', tenantId: 't2' },
  });
  const started = async (open?: Parameters<typeof socketHost>[1] extends infer O ? O : never) => {
    const made = await socketHost(() => (async function* () {})(), {
      ...open,
      deps: {
        allowedOrigins: (session) =>
          session.scope.level === 'tenant' && session.scope.tenantId === 't2'
            ? ['https://two.example']
            : ['https://one.example'],
      },
    });
    hosts.push(made);
    return made;
  };
  const live = (result: Awaited<ReturnType<SocketHost['connect']>>): LiveSocketClient => {
    if (!('socket' in result)) throw new Error(`refused with ${result.status}`);
    return result;
  };

  test('a bearer in the hello opens from any Origin and the cookie of the upgrade is dropped', async () => {
    const made = await started();
    const client = live(await made.connect({ cookie: 'a=b', origin: 'https://one.example' }));
    client.send({ type: 'hello', token: 'secret-bearer' });
    expect(await client.next()).toMatchObject({ type: 'welcome' });
    const carrier = made.opened.at(-1);
    expect(carrier?.token).toBe('secret-bearer');
    expect(carrier?.headers?.cookie).toBeUndefined();
    expect(carrier?.headers?.authorization).toBeUndefined();
    await client.close();
    const foreign = live(await made.connect({ origin: 'https://evil.example' }));
    foreign.send({ type: 'hello', token: 'another' });
    expect(await foreign.next()).toMatchObject({ type: 'welcome' });
    await foreign.close();
  });

  test('a hello naming another tenant with cookie credentials meets that tenant’s origins', async () => {
    const made = await started({
      open: async (carrier) => ({
        ok: true,
        value: carrier.headers?.['x-keelwerk-tenant'] === 't2' ? tenantTwo : fakeSession(),
      }),
    });
    const client = live(await made.connect({ cookie: 'a=b', origin: 'https://one.example' }));
    client.send({ type: 'hello', tenant: 't2' });
    expect(await client.next()).toMatchObject({
      type: 'error',
      error: { kind: 'forbidden', code: 'core.csrf' },
    });
    expect(await client.closed).toMatchObject({ code: 4403 });
  });
});
