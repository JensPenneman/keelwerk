import { broadcastNotification } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { parseBroadcastNotification } from './parse-broadcast-notification.ts';

describe('parseBroadcastNotification', () => {
  test('a text of broadcastNotification parses back to its channel and bytes', () => {
    for (const payload of [
      new Uint8Array(),
      new Uint8Array([1]),
      new Uint8Array([0, 255, 10, 7]),
    ]) {
      const parsed = parseBroadcastNotification(broadcastNotification('topic:a', payload));
      expect(parsed?.channel).toBe('topic:a');
      expect([...(parsed?.payload ?? [])]).toEqual([...payload]);
    }
  });

  test('a text without a newline, with a refused channel or with a payload that is not base64 is undefined', () => {
    expect(parseBroadcastNotification('no newline')).toBeUndefined();
    expect(parseBroadcastNotification('\nAQID')).toBeUndefined();
    expect(parseBroadcastNotification(`${'a'.repeat(201)}\nAQID`)).toBeUndefined();
    expect(parseBroadcastNotification('a\nnot base64!')).toBeUndefined();
    expect(parseBroadcastNotification('a\nAQI')).toBeUndefined();
  });
});
