import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { inertSpan, type LoggedLine, recordingLogger } from '../../test/executor-kit.ts';
import { executorEgress } from './executor-egress.ts';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.closeAllConnections();
          server.close(() => {
            done();
          });
        }),
    ),
  );
});

async function serve(
  answer: (request: { method: string; url: string; body: string }) => {
    status: number;
    body: string;
  },
): Promise<string> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const given = answer({
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
      });
      response.writeHead(given.status, { 'content-type': 'text/plain' });
      response.end(given.body);
    });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function egress(
  options: {
    allow?: readonly string[];
    lookup?: (host: string) => Promise<readonly string[]>;
    signal?: AbortSignal;
  } = {},
) {
  const lines: LoggedLine[] = [];
  return {
    lines,
    egress: executorEgress({
      policy: options.allow === undefined ? undefined : { allow: options.allow },
      effectId: 'eff-1',
      log: recordingLogger(lines),
      trace: inertSpan(),
      signal: options.signal ?? new AbortController().signal,
      ...(options.lookup === undefined ? {} : { lookup: options.lookup }),
    }),
  };
}

describe('executorEgress', () => {
  test.each([
    'http://127.0.0.1/',
    'http://10.1.2.3/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data',
    'http://[::7f00:1]/',
    'http://[::a9fe:a9fe]/latest/meta-data',
    'http://[::ffff:0:7f00:1]/',
    'http://[64:ff9b::a9fe:a9fe]/latest/meta-data',
    'http://[64:ff9b:1::a9fe:a9fe]/latest/meta-data',
    'http://[2002:a9fe:a9fe::1]/',
    'http://[2002:7f00:1::]/',
  ])('refuses the special-purpose address %s with forbidden', async (url) => {
    await expect(egress().egress.fetch(url)).rejects.toMatchObject({
      kind: 'forbidden',
      code: 'core.forbidden',
    });
  });

  test('refuses a name that resolves to a private address, and one with any private address among its records', async () => {
    const privateOnly = egress({ lookup: () => Promise.resolve(['192.168.1.1']) });
    await expect(privateOnly.egress.fetch('https://printer.example/')).rejects.toMatchObject({
      code: 'core.forbidden',
    });
    const mixed = egress({ lookup: () => Promise.resolve(['93.184.216.34', '10.0.0.5']) });
    await expect(mixed.egress.fetch('https://rebind.example/')).rejects.toMatchObject({
      code: 'core.forbidden',
    });
  });

  test('refuses an address that is not http or https, and an address that is no URL', async () => {
    const { egress: out } = egress({ allow: ['127.0.0.0/8'] });
    await expect(out.fetch('file:///etc/passwd')).rejects.toMatchObject({ kind: 'validation' });
    await expect(out.fetch('ftp://127.0.0.1/')).rejects.toMatchObject({ kind: 'validation' });
    await expect(out.fetch('not a url')).rejects.toMatchObject({ kind: 'validation' });
  });

  test('an allowed block admits a local server; the answer is { status, text() } and the log line names the effect and host, never the path or query', async () => {
    const base = await serve((request) => ({
      status: request.method === 'POST' ? 201 : 200,
      body: `got ${request.body}`,
    }));
    const { egress: out, lines } = egress({ allow: ['127.0.0.0/8'] });
    const answer = await out.fetch(`${base}/secret/path?token=abc`, {
      method: 'POST',
      body: 'hello',
      headers: { 'x-test': '1' },
    });
    expect(answer.status).toBe(201);
    expect(await answer.text()).toBe('got hello');
    const logged = lines.filter((line) => line.message === 'egress');
    expect(logged).toEqual([
      {
        level: 'info',
        message: 'egress',
        fields: { effect: 'eff-1', method: 'POST', host: '127.0.0.1', status: 201 },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('secret');
    expect(JSON.stringify(lines)).not.toContain('token=abc');
  });

  test('a name resolving to an allowed address connects to the address the check saw', async () => {
    const base = await serve(() => ({ status: 200, body: 'ok' }));
    const port = new URL(base).port;
    const { egress: out } = egress({
      allow: ['127.0.0.1'],
      lookup: () => Promise.resolve(['127.0.0.1']),
    });
    const answer = await out.fetch(`http://hooks.example:${port}/`);
    expect(answer.status).toBe(200);
  });

  test('an answer larger than 1 MiB is unsupported', async () => {
    const base = await serve(() => ({ status: 200, body: 'x'.repeat(1024 * 1024 + 1) }));
    const { egress: out } = egress({ allow: ['127.0.0.0/8'] });
    await expect(out.fetch(base)).rejects.toMatchObject({ kind: 'unsupported' });
  });

  test('a network failure is unavailable and carries no part of the address', async () => {
    const { egress: out, lines } = egress({ allow: ['127.0.0.0/8'] });
    // Port 1 on loopback accepts no connection.
    await expect(out.fetch('http://127.0.0.1:1/private/path')).rejects.toMatchObject({
      kind: 'unavailable',
      code: 'core.unavailable',
    });
    expect(JSON.stringify(lines)).not.toContain('private');
  });

  test('a malformed allow entry fails at construction, never by letting an address through', () => {
    expect(() => egress({ allow: ['not-a-block'] })).toThrow(
      expect.objectContaining({ kind: 'validation' }),
    );
    expect(() => egress({ allow: ['10.0.0.0/33'] })).toThrow(
      expect.objectContaining({ kind: 'validation' }),
    );
  });

  test('a name whose AAAA record embeds a private IPv4 address is refused, on every embedding form', async () => {
    for (const address of [
      '64:ff9b:1::c0a8:101',
      // The local-use prefix at its other lengths: the translator reads 192.168.0.1 (/48) and 192.168.1.1 (/56, /64).
      '64:ff9b:1:c0a8:0:100:808:808',
      '64:ff9b:1:c0:a8:101::',
      '64:ff9b:1:0:c0:a801:101:0',
      '64:ff9b::c0a8:101',
      '::ffff:0:c0a8:101',
      '::c0a8:101',
    ]) {
      const { egress: out } = egress({ lookup: () => Promise.resolve([address]) });
      await expect(out.fetch('https://router.example/')).rejects.toMatchObject({
        code: 'core.forbidden',
      });
    }
  });

  test('an allow entry for the IPv4 block admits the IPv6 address that embeds it, and nothing else of that form', async () => {
    const private4 = { allow: ['10.0.0.0/8'] };
    const embeds = executorEgress({
      policy: private4,
      effectId: 'eff-1',
      log: recordingLogger(),
      trace: inertSpan(),
      signal: AbortSignal.timeout(300),
      lookup: () => Promise.resolve(['64:ff9b::a00:1']),
    });
    // Admitted by the policy: the attempt goes on to connect (cut off here by the signal, not refused at the check).
    await expect(embeds.fetch('http://nat.example:1/')).rejects.not.toMatchObject({
      code: 'core.forbidden',
    });
    const other = executorEgress({
      policy: private4,
      effectId: 'eff-1',
      log: recordingLogger(),
      trace: inertSpan(),
      signal: new AbortController().signal,
      lookup: () => Promise.resolve(['64:ff9b::a9fe:a9fe']),
    });
    await expect(other.fetch('http://nat.example:1/')).rejects.toMatchObject({
      code: 'core.forbidden',
    });
  });

  test('no request starts once the attempt has ended', async () => {
    let hits = 0;
    const base = await serve(() => {
      hits += 1;
      return { status: 200, body: 'ok' };
    });
    const attempt = new AbortController();
    const { egress: out } = egress({ allow: ['127.0.0.0/8'], signal: attempt.signal });
    attempt.abort(new Error('the attempt ended'));
    await expect(out.fetch(base)).rejects.toThrow('the attempt ended');
    expect(hits).toBe(0);
  });

  test('a request that passes no signal is aborted with the attempt', async () => {
    const hang = createServer(() => undefined);
    servers.push(hang);
    await new Promise<void>((ready) => hang.listen(0, '127.0.0.1', ready));
    const attempt = new AbortController();
    const { egress: out } = egress({ allow: ['127.0.0.0/8'], signal: attempt.signal });
    const pending = out.fetch(`http://127.0.0.1:${(hang.address() as AddressInfo).port}/`);
    setTimeout(() => {
      attempt.abort(new Error('the attempt ended'));
    }, 50);
    await expect(pending).rejects.toThrow();
  });

  test("the executor's own signal still aborts its request", async () => {
    const hang = createServer(() => undefined);
    servers.push(hang);
    await new Promise<void>((ready) => hang.listen(0, '127.0.0.1', ready));
    const { egress: out } = egress({ allow: ['127.0.0.0/8'] });
    const own = new AbortController();
    const pending = out.fetch(`http://127.0.0.1:${(hang.address() as AddressInfo).port}/`, {
      signal: own.signal,
    });
    setTimeout(() => {
      own.abort(new Error('the executor gave up'));
    }, 50);
    await expect(pending).rejects.toThrow();
  });
});
