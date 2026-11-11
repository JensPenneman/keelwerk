import type { LiveFrame, StateToken } from '@keelwerk/core';
import { KeelwerkError } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { frameBytes } from '../../src/hub/frame-bytes.ts';
import { createSubscriptionBuffer } from '../../src/hub/subscription-buffer.ts';

const item = (text: string, state?: string): LiveFrame<unknown> => ({
  event: { text },
  ...(state === undefined ? {} : { state: state as StateToken }),
});

describe('the subscription buffer', () => {
  test('the item limit refuses the frame past it and queues nothing', async () => {
    const buffer = createSubscriptionBuffer({ maxItems: 2, maxBytes: 10_000 });
    expect(buffer.push(item('a'))).toBe(true);
    expect(buffer.push(item('b'))).toBe(true);
    expect(buffer.push(item('c'))).toBe(false);
    expect(buffer.items).toBe(2);
    await buffer.next();
    expect(buffer.push(item('c'))).toBe(true);
  });

  test('the byte limit counts every frame, control frames included, and releases on next', async () => {
    const control: LiveFrame<unknown> = {
      control: 'head',
      state: 'v1.0.0.aaaaaaaa.bbbbbbbb' as StateToken,
    };
    const one = frameBytes(item('x'.repeat(100)));
    const buffer = createSubscriptionBuffer({
      maxItems: 100,
      maxBytes: one * 2 + frameBytes(control) - 1,
    });
    expect(buffer.push(control)).toBe(true);
    expect(buffer.push(item('x'.repeat(100)))).toBe(true);
    expect(buffer.bytes).toBe(frameBytes(control) + one);
    expect(buffer.push(item('x'.repeat(100)))).toBe(false);
    await buffer.next();
    expect(buffer.bytes).toBe(one);
    expect(buffer.push(item('x'.repeat(100)))).toBe(true);
  });

  test('lastDelivered is the state of the last frame next returned that carried one', async () => {
    const buffer = createSubscriptionBuffer({ maxItems: 10, maxBytes: 10_000 });
    expect(buffer.lastDelivered).toBeUndefined();
    buffer.push(item('a', 'v1.0.1.aaaaaaaa.bbbbbbbb'));
    buffer.push(item('b'));
    buffer.push(item('c', 'v1.0.3.aaaaaaaa.bbbbbbbb'));
    await buffer.next();
    await buffer.next();
    expect(buffer.lastDelivered).toBe('v1.0.1.aaaaaaaa.bbbbbbbb');
    await buffer.next();
    expect(buffer.lastDelivered).toBe('v1.0.3.aaaaaaaa.bbbbbbbb');
  });

  test('replaceWith drops what was queued and ends the stream after the frame', async () => {
    const buffer = createSubscriptionBuffer({ maxItems: 10, maxBytes: 10_000 });
    buffer.push(item('a'));
    buffer.push(item('b'));
    buffer.replaceWith({ control: 'reset', reason: 'overflow' });
    expect(buffer.items).toBe(1);
    expect(await buffer.next()).toEqual({
      done: false,
      value: { control: 'reset', reason: 'overflow' },
    });
    expect(await buffer.next()).toEqual({ done: true, value: undefined });
  });

  test('a waiting next is handed the next frame, and fail ends it with the error', async () => {
    const buffer = createSubscriptionBuffer({ maxItems: 10, maxBytes: 10_000 });
    const waiting = buffer.next();
    buffer.push(item('a'));
    expect(await waiting).toEqual({ done: false, value: item('a') });
    const failing = buffer.next();
    const error = new KeelwerkError({
      kind: 'unavailable',
      code: 'core.unavailable',
      message: 'gone',
    });
    buffer.fail(error);
    await expect(failing).rejects.toBe(error);
    expect(await buffer.next()).toEqual({ done: true, value: undefined });
  });

  test('whenBelowHalf waits until the buffer has drained to half of both limits', async () => {
    const buffer = createSubscriptionBuffer({ maxItems: 4, maxBytes: 10_000 });
    buffer.push(item('a'));
    buffer.push(item('b'));
    buffer.push(item('c'));
    let released = false;
    void buffer.whenBelowHalf().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    await buffer.next();
    await buffer.next();
    await Promise.resolve();
    expect(released).toBe(true);
  });

  test('a frame that alone exceeds the byte limit is accepted into an empty buffer', () => {
    const buffer = createSubscriptionBuffer({ maxItems: 10, maxBytes: 50 });
    expect(buffer.push(item('x'.repeat(500)))).toBe(true);
    expect(buffer.push(item('y'))).toBe(false);
  });
});
