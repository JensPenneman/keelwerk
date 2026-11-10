import { stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { brotliDecompressSync } from 'node:zlib';
import {
  protocolCodec,
  startTransportRuntime,
  testPrincipal,
  transportTargetOf,
} from '@keelwerk/testing';
import { transportApp } from '@keelwerk/testing/fixtures';
import { describe, expect, test } from 'vitest';
import { httpHost } from '../src/index.ts';
import { slowClosing, slowClosingApp } from './support/slow-closing-app.ts';

describe('listen hands the transports to the host the runtime builds', () => {
  test('the runtime serves a host while it listens, and the host stops with it', async () => {
    const running = await startTransportRuntime({ app: transportApp, host: httpHost() });
    expect(running.runtime.host).toBeDefined();
    const operator = transportTargetOf(running, protocolCodec, []).operatorFetch;
    const before = await operator(new Request('http://localhost/_keelwerk/v1/surface'));
    expect(before.status).toBe(200);
    expect(await before.json()).toMatchObject({ app: 'transport', apiVersion: '2026-11-04' });
    await running.stop();
    await expect(operator(new Request('http://localhost/_keelwerk/v1/surface'))).rejects.toThrow();
  });
});

describe('stop starts the host before it waits for the mounts', () => {
  test('a mount that closes only at the deadline does not delay the host stop, and a request in flight does not hold the stop', async () => {
    const events: string[] = [];
    slowClosing.settled = () => events.push('mount settled');
    const entry = httpHost();
    const host: typeof entry = {
      ...entry,
      create(deps) {
        const instance = entry.create(deps);
        return {
          ...instance,
          stop(deadlineMs) {
            events.push('host stop');
            return instance.stop(deadlineMs);
          },
        };
      },
    };
    const running = await startTransportRuntime({ app: slowClosingApp, host });
    let finish: () => void = () => undefined;
    const inFlight = running
      .fetch(
        new Request(`https://acme.example.test${protocolCodec.endpoint}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-test-principal': 'ada' },
          body: new ReadableStream({
            start: (controller) => {
              finish = () => controller.close();
            },
          }),
          duplex: 'half',
        } as RequestInit),
      )
      .catch(() => undefined);
    const started = performance.now();
    await running.runtime.stop(300);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(events[0]).toBe('host stop');
    finish();
    await inFlight;
    await running.stop();
  });
});

describe('the host the runtime builds listens and compresses', () => {
  test('the runtime opens the TCP listener it builds, reports its port and socket, and stop closes it within the deadline', async () => {
    const running = await startTransportRuntime({
      app: transportApp,
      host: httpHost({ listen: { port: 0 } }),
    });
    const { runtime } = running;
    expect(runtime.port).toBeGreaterThan(0);
    const socket = runtime.operatorSocket;
    expect(socket).toBeTypeOf('string');
    expect((await stat(socket as string)).isSocket()).toBe(true);
    const health = await fetch(`http://127.0.0.1:${runtime.port}/_keelwerk/health`);
    expect(health.status).toBe(200);
    await health.arrayBuffer();
    const started = performance.now();
    await runtime.stop(1000);
    expect(performance.now() - started).toBeLessThan(3000);
    await expect(fetch(`http://127.0.0.1:${runtime.port}/_keelwerk/health`)).rejects.toThrow();
    await expect(
      new Promise((resolve, reject) => {
        const client = connect(socket as string);
        client.once('connect', () => {
          client.destroy();
          resolve('connected');
        });
        client.once('error', reject);
      }),
    ).rejects.toThrow();
    await running.stop();
  });

  test('a surface over 1 KiB is served compressed through the host', async () => {
    const running = await startTransportRuntime({ app: transportApp, host: httpHost() });
    const response = await running.fetch(
      new Request('https://acme.example.test/_keelwerk/v1/surface', {
        headers: {
          'accept-encoding': 'br',
          'x-test-principal': JSON.stringify(testPrincipal('ada')),
        },
      }),
    );
    expect(response.headers.get('content-encoding')).toBe('br');
    const text = brotliDecompressSync(Buffer.from(await response.arrayBuffer())).toString();
    expect(text.length).toBeGreaterThan(1024);
    expect(JSON.parse(text)).toMatchObject({ app: 'transport' });
    await running.stop();
  });
});
