import { describe, expect, it } from 'vitest';
import { deriveUuidV8 } from './derive-uuid-v8.ts';

const pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deriveUuidV8', () => {
  it('is deterministic and shaped as a version 8 UUID', () => {
    const id = deriveUuidV8('scope-1', 'command-1');
    expect(id).toBe(deriveUuidV8('scope-1', 'command-1'));
    expect(id).toMatch(pattern);
  });

  it('differs per input and per part boundary', () => {
    expect(deriveUuidV8('a', 'b')).not.toBe(deriveUuidV8('a', 'c'));
    expect(deriveUuidV8('ab', 'c')).not.toBe(deriveUuidV8('a', 'bc'));
    expect(deriveUuidV8('a')).not.toBe(deriveUuidV8('a', ''));
  });

  it('pins one value so the stored format cannot drift', () => {
    expect(deriveUuidV8('scope', 'command')).toBe('c427263f-c019-8e7b-8135-e810d779ca72');
  });
});
