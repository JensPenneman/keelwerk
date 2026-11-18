import { describe, expect, it } from 'vitest';
import { isOpaqueId } from './is-opaque-id.ts';

describe('isOpaqueId', () => {
  it.each([
    ['a version 4 UUID', '2d9b8c4e-6f1a-4b7d-9c3e-5a1f0e8d7b6c'],
    ['a version 7 UUID', '01930000-0000-7000-8000-000000000001'],
    ['an upper-case UUID', '2D9B8C4E-6F1A-4B7D-9C3E-5A1F0E8D7B6C'],
    ['a ULID', '01ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['a lower-case ULID', '01arz3ndektsv4rrffq69g5fav'],
  ])('passes %s', (_name, text) => {
    expect(isOpaqueId(text)).toBe(true);
  });

  it.each([
    ['a version 1 UUID, which holds a MAC address', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    ['a version 6 UUID, which holds a MAC address', '1ef21d2f-1207-6660-8c4f-419efbd44d48'],
    [
      'a version 8 UUID, whose standard names a hash of a name',
      '2489e9ad-2ee2-8e00-8ec9-32d5f69181c0',
    ],
    ['a version 3 UUID', '6fa459ea-ee8a-3ca4-894e-db77e160355e'],
    ['a version 5 UUID', '886313e1-3b8a-5372-9b90-0c9aee199e5d'],
    ['32 hexadecimal characters without hyphens', '2d9b8c4e6f1a4b7d9c3e5a1f0e8d7b6c'],
    ['an email address', 'order-jan@example.com'],
    ['a kernel id', 'kernel:x'],
    ['an empty text', ''],
    ['a ULID that starts above 7', '81ARZ3NDEKTSV4RRFFQ69G5FAV'],
    ['a ULID with a character outside the alphabet', '01ARZ3NDEKTSV4RRFFQ69G5FAU'],
    ['a UUID with a trailing character', '01930000-0000-7000-8000-000000000001x'],
  ])('does not pass %s', (_name, text) => {
    expect(isOpaqueId(text)).toBe(false);
  });
});
