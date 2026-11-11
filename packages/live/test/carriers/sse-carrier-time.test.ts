import { describe, expect, test } from 'vitest';
import { sseCarrier } from '../../src/carriers/sse/sse-carrier.ts';
import { fakeConnection, fedStream, pinned } from '../support/carrier-kit.ts';

describe('the sse carrier on a pinned clock', () => {
  test('a ping comes at start + 15 s and not at 14.999 s', async () => {
    const { connection, written, abort } = fakeConnection();
    const { stream } = fedStream();
    const kit = pinned();
    const served = sseCarrier.serve(stream, connection, kit.options);
    await kit.at(0);
    expect(await kit.at(14_999)).toBe(0);
    expect(written.filter((chunk) => chunk === ': ping\n\n')).toHaveLength(0);
    expect(await kit.at(15_000)).toBe(1);
    expect(written.filter((chunk) => chunk === ': ping\n\n')).toHaveLength(1);
    abort();
    await served;
  });

  test('an item resets the heartbeat', async () => {
    const { connection, written, abort } = fakeConnection();
    const { stream, feed } = fedStream();
    const kit = pinned();
    const served = sseCarrier.serve(stream, connection, kit.options);
    await kit.at(0);
    await kit.at(10_000);
    feed({ event: 1, state: 'v2.a' as never });
    await kit.at(10_000);
    const pings = () => written.filter((chunk) => chunk === ': ping\n\n').length;
    expect(await kit.at(15_000)).toBe(0);
    expect(pings()).toBe(0);
    expect(await kit.at(24_999)).toBe(0);
    await kit.at(25_000);
    expect(pings()).toBe(1);
    abort();
    await served;
  });

  test('end max_duration comes at exactly start + maxDurationMs and items do not move it', async () => {
    const { connection, ends } = fakeConnection();
    const { stream, feed, state } = fedStream();
    const kit = pinned();
    const served = sseCarrier.serve(stream, connection, {
      ...kit.options,
      heartbeatMs: 1_000_000,
    });
    await kit.at(0);
    feed({ event: 1 });
    await kit.at(59_000);
    feed({ event: 2 });
    expect(await kit.at(59_999)).toBe(0);
    expect(ends).toEqual([]);
    await kit.at(60_000);
    await served;
    expect(ends).toEqual(['max_duration']);
    expect(state.returned).toBe(true);
  });

  test('after the stream ends no wait is pending', async () => {
    const { connection } = fakeConnection();
    const { stream, finish } = fedStream();
    const kit = pinned();
    const served = sseCarrier.serve(stream, connection, kit.options);
    await kit.at(0);
    expect(kit.timers.pending()).toBe(2);
    finish();
    await served;
    expect(kit.timers.pending()).toBe(0);
  });
});
