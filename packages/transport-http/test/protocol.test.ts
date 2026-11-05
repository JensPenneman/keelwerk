import { chmod, mkdir, mkdtemp, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createFakeInvoker } from './support/fake-invoker.ts';
import { postJson } from './support/post-json.ts';
import { requestSocket } from './support/request-socket.ts';
import { useHosts } from './support/use-hosts.ts';

const { setup, directories } = useHosts();

describe('the invocation protocol', () => {
  it('invokes an action through host.fetch and echoes the version and request id', async () => {
    const { host, invoker } = setup();
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.echo', input: { a: 1 } }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, value: 'echo:{"a":1}' });
    expect(response.headers.get('keelwerk-version')).toBe('2026-11-01');
    expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers.get('keelwerk-command-id')).toMatch(/^[0-9a-f-]{36}$/);
    expect(invoker.invoked[0]?.commandId).toBe(response.headers.get('keelwerk-command-id'));
    expect(invoker.invoked[0]?.requestId).toBe(response.headers.get('x-request-id'));
  });

  it('keeps a client command id and does not invent one for a query', async () => {
    const { host, invoker } = setup();
    const kept = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.echo', commandId: 'mine' }),
    );
    expect(kept.headers.get('keelwerk-command-id')).toBeNull();
    const query = await host.fetch(postJson('/_keelwerk/v1/invoke', { action: 'library.lookup' }));
    expect(query.headers.get('keelwerk-command-id')).toBeNull();
    expect(invoker.invoked.map((i) => i.commandId)).toEqual(['mine', undefined]);
  });

  it('encodes outputs with the wire codecs', async () => {
    const { host } = setup();
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', { action: 'library.stamp' }),
    );
    expect(await response.json()).toEqual({ ok: true, value: '2030-01-02T03:04:05.678Z' });
  });

  it('answers the same request over a TCP port', async () => {
    const { host } = setup({ listen: { port: 0 } });
    const { port } = await host.listen();
    const response = await fetch(`http://127.0.0.1:${port}/_keelwerk/v1/invoke`, {
      method: 'POST',
      body: JSON.stringify({ action: 'library.echo', input: 1 }),
    });
    expect(await response.json()).toEqual({ ok: true, value: 'echo:1' });
  });

  it('answers over the operator socket, which is 0600 in a 0700 directory and the only place that sets local.socket', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-op-'));
    directories.push(directory);
    const socket = join(directory, 'run', 'operator.sock');
    const { host, invoker } = setup({ listen: { port: 0 } }, undefined, { operator: { socket } });
    const listening = await host.listen();
    expect(listening.operatorSocket).toBe(socket);
    expect((await stat(socket)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, 'run'))).mode & 0o777).toBe(0o700);
    const body = JSON.stringify({ action: 'library.echo', input: 'x' });
    const viaSocket = await requestSocket(socket, '/_keelwerk/v1/invoke', { method: 'POST', body });
    expect(JSON.parse(viaSocket.text)).toEqual({ ok: true, value: 'echo:"x"' });
    await fetch(`http://127.0.0.1:${listening.port}/_keelwerk/v1/invoke`, { method: 'POST', body });
    await host.fetch(
      postJson(
        '/_keelwerk/v1/invoke',
        { action: 'library.echo' },
        { 'x-forwarded-for': '1.2.3.4' },
      ),
    );
    expect(invoker.opened.map((carrier) => carrier.local)).toEqual([
      { socket },
      undefined,
      undefined,
    ]);
  });

  it('falls back to a short socket path when the configured one is too long', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-op-'));
    directories.push(directory);
    const long = join(directory, 'x'.repeat(120), 'operator.sock');
    const fallbackDirectory = join(directory, 'fallback');
    const { host } = setup({}, undefined, { operator: { socket: long, fallbackDirectory } });
    const { operatorSocket } = await host.listen();
    expect(operatorSocket).not.toBe(long);
    expect(Buffer.byteLength(operatorSocket ?? '')).toBeLessThan(104);
    expect(operatorSocket?.startsWith(fallbackDirectory)).toBe(true);
  });

  it('refuses an operator socket directory that is a symbolic link', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-op-'));
    directories.push(directory);
    await mkdir(join(directory, 'real'), { mode: 0o700 });
    await symlink(join(directory, 'real'), join(directory, 'link'));
    const { host } = setup({}, undefined, {
      operator: { socket: join(directory, 'link', 'op.sock') },
    });
    await expect(host.listen()).rejects.toThrow(/not a link/);
  });

  it('refuses an operator socket directory that is not 0700', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'kw-op-'));
    directories.push(directory);
    await chmod(directory, 0o755);
    const { host } = setup({}, undefined, { operator: { socket: join(directory, 'op.sock') } });
    await expect(host.listen()).rejects.toThrow(/must be 0700.*chmod 700/);
  });
});

describe('receipts', () => {
  it('answers 202 with the receipt as the value for an accepted command', async () => {
    const invoker = createFakeInvoker({
      actions: {
        'library.echo': () => ({
          ok: true,
          value: undefined,
          receipt: { commandId: 'c1', status: 'accepted' },
          receiptId: 'rcpt_01j0000000000000000000000a',
          effects: ['e1'],
        }),
      },
    });
    const { host, invoker: seen } = setup({}, invoker);
    const response = await host.fetch(
      postJson('/_keelwerk/v1/invoke', {
        action: 'library.echo',
        commandId: 'c1',
        prefer: 'async',
      }),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get('preference-applied')).toBe('respond-async');
    expect(await response.json()).toEqual({
      ok: true,
      value: { commandId: 'c1', status: 'accepted' },
      receipt: { commandId: 'c1', status: 'accepted' },
      receiptId: 'rcpt_01j0000000000000000000000a',
      effects: ['e1'],
    });
    expect(seen.invoked[0]?.prefer).toBe('async');
  });
});

describe('batches', () => {
  it('runs invocations in order, each on its own', async () => {
    const { host } = setup();
    const response = await host.fetch(
      postJson('/_keelwerk/v1/batch', {
        invocations: [
          { action: 'library.echo', input: 1 },
          { action: 'library.nothing' },
          { action: 'library.lookup' },
        ],
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { results: { ok: boolean; value?: unknown }[] };
    expect(body.results.map((r) => r.ok)).toEqual([true, false, true]);
    expect(body.results[0]?.value).toBe('echo:1');
  });

  it('returns the generated command ids so a retried batch replays', async () => {
    const { host, invoker } = setup();
    const first = await host.fetch(
      postJson('/_keelwerk/v1/batch', {
        invocations: [
          { action: 'library.echo', input: 1 },
          { action: 'library.lookup' },
          { action: 'library.echo', input: 2, commandId: 'mine' },
        ],
      }),
    );
    const { results } = (await first.json()) as { results: { commandId?: string }[] };
    const [one, query, kept] = results;
    expect(one?.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(query?.commandId).toBeUndefined();
    expect(kept?.commandId).toBeUndefined();
    await host.fetch(
      postJson('/_keelwerk/v1/batch', {
        invocations: [{ action: 'library.echo', input: 1, commandId: one?.commandId }],
      }),
    );
    expect(invoker.invoked[3]?.commandId).toBe(one?.commandId);
    expect(invoker.invoked[0]?.commandId).toBe(one?.commandId);
  });

  it('refuses 21 invocations and accepts 20', async () => {
    const { host } = setup();
    const many = (n: number) => ({
      invocations: Array.from({ length: n }, () => ({ action: 'library.lookup' })),
    });
    const refused = await host.fetch(postJson('/_keelwerk/v1/batch', many(21)));
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { error: { kind: string } }).error.kind).toBe('validation');
    const accepted = await host.fetch(postJson('/_keelwerk/v1/batch', many(20)));
    expect(accepted.status).toBe(200);
  });
});

describe('surface and capabilities', () => {
  it('serves the surface with an ETag and answers 304 for a matching If-None-Match', async () => {
    const { host } = setup();
    const first = await host.fetch(new Request('https://library.example/_keelwerk/v1/surface'));
    expect(first.status).toBe(200);
    expect(first.headers.get('etag')).toBe('"sha256-library"');
    expect(((await first.json()) as { hash: string }).hash).toBe('sha256-library');
    const second = await host.fetch(
      new Request('https://library.example/_keelwerk/v1/surface', {
        headers: { 'if-none-match': '"sha256-library"' },
      }),
    );
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('serves core.capabilities', async () => {
    const document = { protocols: { invocation: [1] }, apiVersions: [] };
    const invoker = createFakeInvoker({
      actions: { 'core.capabilities': () => ({ ok: true, value: document }) },
    });
    const { host } = setup({}, invoker);
    const response = await host.fetch(
      new Request('https://library.example/_keelwerk/v1/capabilities'),
    );
    expect(await response.json()).toEqual(document);
  });

  it('answers health and ready without a session', async () => {
    const { host, invoker } = setup({}, undefined, { ready: async () => false });
    const health = await host.fetch(new Request('https://library.example/_keelwerk/health'));
    expect(health.status).toBe(200);
    const ready = await host.fetch(new Request('https://library.example/_keelwerk/ready'));
    expect(ready.status).toBe(503);
    expect(invoker.opened).toHaveLength(0);
  });
});
