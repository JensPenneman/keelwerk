import type { LiveFrame, StateToken } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { frameBytes } from '../../src/hub/frame-bytes.ts';

describe('frameBytes', () => {
  test('counts the UTF-8 length of the JSON text', () => {
    const frame: LiveFrame<unknown> = { event: { title: 'é' } };
    expect(frameBytes(frame)).toBe(new TextEncoder().encode('{"event":{"title":"é"}}').length);
    expect(frameBytes({ control: 'gap' })).toBe('{"control":"gap"}'.length);
  });

  test('counts a bigint as its decimal digits', () => {
    const frame: LiveFrame<unknown> = { event: { position: 12_345_678_901_234_567_890n } };
    expect(frameBytes(frame)).toBe('{"event":{"position":"12345678901234567890"}}'.length);
  });

  test('counts a Temporal value as its text', () => {
    const instant = Temporal.Instant.from('2026-11-11T10:00:00Z');
    const frame: LiveFrame<unknown> = { event: { at: instant }, state: 'v1' as StateToken };
    expect(frameBytes(frame)).toBe(
      JSON.stringify({ event: { at: '2026-11-11T10:00:00Z' }, state: 'v1' }).length,
    );
  });

  test('counts bytes by their base64 size', () => {
    expect(frameBytes({ event: { blob: new Uint8Array(3) } })).toBe(
      '{"event":{"blob":"xxxx"}}'.length,
    );
  });
});
