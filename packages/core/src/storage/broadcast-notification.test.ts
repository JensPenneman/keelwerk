import { describe, expect, test, vi } from 'vitest';
import { broadcastNotification } from './broadcast-notification.ts';

describe('broadcastNotification', () => {
  test('the text is the channel, a newline and the padded base64 of the payload', () => {
    expect(broadcastNotification('topic:a', new Uint8Array([1, 2, 3, 4]))).toBe(
      'topic:a\nAQIDBA==',
    );
  });

  test('a text of 7,999 bytes is accepted and one of 8,000 is refused with core.payload_too_large naming the channel and the limit', () => {
    // 5,997 payload bytes encode to 7,996 base64 characters; the channel and the newline come on top.
    const payload = new Uint8Array(5_997);
    const accepted = broadcastNotification('cc', payload);
    expect(new TextEncoder().encode(accepted).length).toBe(7_999);
    try {
      broadcastNotification('ccc', payload);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        kind: 'validation',
        code: 'core.payload_too_large',
        details: { channel: 'ccc', bytes: 8_000, limit: 8_000 },
        message: 'The broadcast on ccc is 8,000 bytes; a notification holds fewer than 8,000.',
      });
    }
  });

  test('the size is computed before encoding: 5,997 bytes on channel a give 7,998 and 5,998 bytes are refused with 8,002', () => {
    const accepted = broadcastNotification('a', new Uint8Array(5_997));
    expect(new TextEncoder().encode(accepted).length).toBe(7_998);
    const spy = vi.spyOn(globalThis, 'btoa');
    try {
      expect(() => broadcastNotification('a', new Uint8Array(5_998))).toThrowError(
        expect.objectContaining({
          code: 'core.payload_too_large',
          details: { channel: 'a', bytes: 8_002, limit: 8_000 },
        }),
      );
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('an invalid channel is refused as validation before the size, even for a payload far over the limit', () => {
    expect(() => broadcastNotification('a'.repeat(201), new Uint8Array(10_000_000))).toThrowError(
      expect.objectContaining({ kind: 'validation', code: 'core.validation' }),
    );
  });

  test('the channel length is counted in UTF-16 code units, and the refusal says so', () => {
    expect(() => broadcastNotification('\u{1F600}'.repeat(101), new Uint8Array())).toThrowError(
      'a broadcast channel is 1 to 200 UTF-16 code units',
    );
    expect(broadcastNotification('\u{1F600}'.repeat(100), new Uint8Array())).toBe(
      `${'\u{1F600}'.repeat(100)}\n`,
    );
  });

  test('a channel that is empty, longer than 200 UTF-16 code units (201 letters, or 101 emoji of 202), or holds a newline, U+0000 or a lone surrogate is validation', () => {
    for (const channel of [
      '',
      'a'.repeat(201),
      'a\nb',
      'a\u0000b',
      't\uD800',
      '\u{1F600}'.repeat(101),
    ]) {
      expect(() => broadcastNotification(channel, new Uint8Array())).toThrowError(
        expect.objectContaining({ kind: 'validation', code: 'core.validation' }),
      );
    }
  });
});
