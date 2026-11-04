import { describe, expect, it } from 'vitest';
import { postJson } from './support/post-json.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup } = useHosts();

describe('graceful shutdown', () => {
  it('drains an in-flight request, then refuses new ones with 503', async () => {
    const { host } = setup();
    let release: () => void = () => {};
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return new Response('done');
    });
    const inflight = host.fetch(postJson('/api', {}));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stopped = host.stop(2000);
    const refused = await host.fetch(postJson('/api', {}));
    expect(refused.status).toBe(503);
    expect(refused.headers.get('retry-after')).toBe('1');
    release();
    expect(await (await inflight).text()).toBe('done');
    await stopped;
  });

  it('gives up at the deadline', async () => {
    const { host } = setup();
    host.route({ app: 'library', transport: 'rest', prefix: '/api' }, () => new Promise(() => {}));
    void host.fetch(postJson('/api', {}));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    await host.stop(50);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('closes its listener', async () => {
    const { host } = setup({ listen: { port: 0 } });
    const { port } = await host.listen();
    await host.stop(100);
    await expect(fetch(`http://127.0.0.1:${port}/_keelwerk/health`)).rejects.toThrow();
  });
});
