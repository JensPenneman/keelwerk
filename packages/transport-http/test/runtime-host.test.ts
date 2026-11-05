import { protocolCodec, startTransportRuntime, transportTargetOf } from '@keelwerk/testing';
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
