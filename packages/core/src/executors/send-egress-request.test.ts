import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { afterEach, describe, expect, test } from 'vitest';

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

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  return (server.address() as AddressInfo).port;
}

const source = new URL('./send-egress-request.ts', import.meta.url).href;

/** Runs one egress request in a process of its own, as a deployment that sets a proxy in its environment would. */
function requestIn(env: Record<string, string>, target: string): Promise<string> {
  const script = `
    const { sendEgressRequest } = await import(${JSON.stringify(source)});
    const answer = await sendEgressRequest(new URL(${JSON.stringify(target)}), { address: '127.0.0.1', family: 4 }, {});
    process.stdout.write(String(answer.status) + ' ' + answer.text);
  `;
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--input-type=module', '-e', script],
      { env, timeout: 20_000 },
      (error, stdout, stderr) => {
        if (error === null) resolve(stdout);
        else reject(new Error(`${error.message}\n${stderr}`));
      },
    );
  });
}

describe('sendEgressRequest and the environment', () => {
  test('HTTP_PROXY, HTTPS_PROXY and NODE_USE_ENV_PROXY do not change the connection: it goes to the pinned address', async () => {
    const viaProxy: string[] = [];
    const proxy = await listen((request, response) => {
      viaProxy.push(request.url ?? '');
      response.writeHead(502);
      response.end('the proxy answered');
    });
    const target = await listen((_request, response) => {
      response.writeHead(200);
      response.end('the destination answered');
    });
    const proxyUrl = `http://127.0.0.1:${proxy}`;
    const answer = await requestIn(
      Object.fromEntries(
        ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
          .map((name) => [name, proxyUrl])
          .concat([['NODE_USE_ENV_PROXY', '1']]),
      ),
      `http://pinned.example:${target}/path`,
    );
    expect(answer).toBe('200 the destination answered');
    expect(viaProxy).toEqual([]);
  }, 30_000);
});
