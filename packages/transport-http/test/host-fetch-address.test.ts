import { describe, expect, it } from 'vitest';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();
const lookup = (headers: Record<string, string> = {}): Request =>
  postJson('/_keelwerk/v1/invoke', { action: 'library.lookup' }, headers);

describe('the client address of host.fetch', () => {
  it('reports the loopback as the client address when its caller names none', async () => {
    const { host, invoker } = setup();
    await host.fetch(lookup());
    expect(invoker.opened[0]?.connection?.remote.address).toBe('127.0.0.1');
  });

  it('takes the client address its caller names', async () => {
    const { host, invoker } = setup();
    await host.fetch(lookup(), { remoteAddress: '198.18.0.5' });
    await host.fetch(lookup(), { remoteAddress: '2001:db8::5' });
    expect(invoker.opened[0]?.connection?.remote.address).toBe('198.18.0.5');
    expect(invoker.opened[1]?.connection?.remote.address).toBe('2001:db8::5');
  });

  it('puts the address in one standard form', async () => {
    const { host, invoker } = setup();
    await host.fetch(lookup(), { remoteAddress: '::ffff:203.0.113.7' });
    await host.fetch(lookup(), { remoteAddress: '2001:DB8::5' });
    await host.fetch(lookup(), { remoteAddress: '2001:0db8:0:0:0:0:0:5' });
    await host.fetch(lookup(), { remoteAddress: '::FFFF:cb00:7107' });
    expect(invoker.opened.map((call) => call.connection?.remote.address)).toEqual([
      '203.0.113.7',
      '2001:db8::5',
      '2001:db8::5',
      '203.0.113.7',
    ]);
  });

  it('refuses an address with a zone suffix', async () => {
    const { host, invoker } = setup();
    await expect(host.fetch(lookup(), { remoteAddress: 'fe80::1%eth0' })).rejects.toThrow(
      TypeError,
    );
    await expect(
      host.fetch(lookup(), { remoteAddress: 'fe80::1%anything-at-all' }),
    ).rejects.toThrow(TypeError);
    expect(invoker.opened).toHaveLength(0);
  });

  it('never reads x-forwarded-for, even when the deployment trusts the loopback', async () => {
    const { host, invoker } = setup({ trustedProxies: ['127.0.0.0/8'] });
    await host.fetch(lookup({ 'x-forwarded-for': '203.0.113.9' }));
    await host.fetch(lookup({ 'x-forwarded-for': '203.0.113.9' }), { remoteAddress: '198.18.0.5' });
    expect(invoker.opened[0]?.connection?.remote.address).toBe('127.0.0.1');
    expect(invoker.opened[1]?.connection?.remote.address).toBe('198.18.0.5');
  });

  it('refuses a remote address that is no IP address', async () => {
    const { host, invoker } = setup();
    await expect(host.fetch(lookup(), { remoteAddress: 'not-an-address' })).rejects.toThrow(
      TypeError,
    );
    await expect(host.fetch(lookup(), { remoteAddress: '' })).rejects.toThrow(TypeError);
    expect(invoker.opened).toHaveLength(0);
  });
});
