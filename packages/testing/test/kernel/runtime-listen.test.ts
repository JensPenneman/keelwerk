import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { boot, deploymentOf } from './support/runtime-kit.ts';

const registrationKey = Symbol.for('keelwerk.telemetry');
const servers: Server[] = [];

afterEach(async () => {
  Reflect.deleteProperty(globalThis, registrationKey);
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe('the runtime-owned listen phase', () => {
  test('a deployment without httpHost starts no listener', async () => {
    const runtime = await boot(deploymentOf('memory'), { listen: true });
    expect(runtime.host).toBeUndefined();
    expect(runtime.port).toBeUndefined();
    expect(runtime.operatorSocket).toBeUndefined();
  });
});

describe('telemetry.otlp', () => {
  test('two runtimes with telemetry.otlp in one process export through one registration', async () => {
    const bodies: string[] = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.url === '/v1/traces') bodies.push(Buffer.concat(chunks).toString('utf8'));
        response.writeHead(200, { 'content-type': 'application/json' }).end('{}');
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const deployment = deploymentOf('memory', { telemetry: { otlp: url } });
    const first = await boot(deployment);
    const registration = Reflect.get(globalThis, registrationKey);
    expect(registration).toBeDefined();
    const second = await boot(deployment);
    expect(Reflect.get(globalThis, registrationKey)).toBe(registration);
    for (const [runtime, name] of [
      [first, 'one'],
      [second, 'two'],
    ] as const) {
      await runtime.control.createBackend({ name, app: 'library', placement: 'main', config: {} });
    }
    await first.stop(1000);
    await second.stop(1000);
    // The spans carry no backend name, so the two runtimes show as two distinct spans, not one retried batch.
    const created = new Set<string>();
    for (const body of bodies) {
      const batch = JSON.parse(body) as {
        resourceSpans: { scopeSpans: { spans: { name: string; spanId: string }[] }[] }[];
      };
      for (const resource of batch.resourceSpans) {
        for (const scope of resource.scopeSpans) {
          for (const span of scope.spans) {
            if (span.name === 'keelwerk.control.backend.create') created.add(span.spanId);
          }
        }
      }
    }
    expect(created.size).toBe(2);
  });
});
