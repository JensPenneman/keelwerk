import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { newUuidV7 } from './new-uuid-v7.ts';
import { parseTypeId } from './parse-type-id.ts';
import { renderTypeId } from './render-type-id.ts';

describe('TypeIDs', () => {
  test('match the specification vectors', () => {
    const zero = '00000000-0000-0000-0000-000000000000';
    expect(renderTypeId('prefix', zero)).toBe('prefix_00000000000000000000000000');
    expect(renderTypeId('', zero)).toBe('00000000000000000000000000');
    expect(renderTypeId('prefix', '00000000-0000-0000-0000-000000000001')).toBe(
      'prefix_00000000000000000000000001',
    );
    expect(renderTypeId('prefix', '00000000-0000-0000-0000-00000000001f')).toBe(
      'prefix_0000000000000000000000000z',
    );
    expect(renderTypeId('prefix', '00000000-0000-0000-0000-000000000020')).toBe(
      'prefix_00000000000000000000000010',
    );
    expect(renderTypeId('prefix', 'ffffffff-ffff-ffff-ffff-ffffffffffff')).toBe(
      'prefix_7zzzzzzzzzzzzzzzzzzzzzzzzz',
    );
  });

  test('round trip with the prefix check', () => {
    const uuid = newUuidV7();
    const text = renderTypeId('prof', uuid);
    expect(text).toMatch(/^prof_[0-9a-hjkmnp-tv-z]{26}$/);
    expect(parseTypeId(text, 'prof')).toBe(uuid);
    expect(parseTypeId(text, 'cred')).toBeUndefined();
    expect(parseTypeId(renderTypeId('', uuid), '')).toBe(uuid);
  });

  test('round trip for any UUID and any valid prefix', () => {
    const prefix = fc.stringMatching(/^(?:[a-z](?:[a-z_]{0,20}[a-z])?)?$/);
    fc.assert(
      fc.property(fc.uuid(), prefix, (uuid, name) => {
        const lower = uuid.toLowerCase();
        expect(parseTypeId(renderTypeId(name, lower), name)).toBe(lower);
      }),
    );
  });

  test('rejects malformed text', () => {
    const good = renderTypeId('prof', newUuidV7());
    const suffix = good.slice(5);
    expect(parseTypeId(suffix, 'prof')).toBeUndefined();
    expect(parseTypeId(`prof_${suffix.slice(1)}`, 'prof')).toBeUndefined();
    expect(parseTypeId(`prof_${suffix.toUpperCase()}`, 'prof')).toBeUndefined();
    expect(parseTypeId(`prof_8${suffix.slice(1)}`, 'prof')).toBeUndefined();
    expect(parseTypeId(`prof_${suffix.slice(0, 25)}u`, 'prof')).toBeUndefined();
    expect(parseTypeId(`pro_${suffix}`, 'prof')).toBeUndefined();
    expect(parseTypeId(`prof_${suffix}`, 'Prof')).toBeUndefined();
    expect(parseTypeId(`_${suffix}`, '')).toBeUndefined();
  });

  test('refuses a malformed prefix or UUID when rendering', () => {
    const uuid = newUuidV7();
    expect(() => renderTypeId('_prof', uuid)).toThrow(TypeError);
    expect(() => renderTypeId('prof_', uuid)).toThrow(TypeError);
    expect(() => renderTypeId('Prof', uuid)).toThrow(TypeError);
    expect(() => renderTypeId('a'.repeat(64), uuid)).toThrow(TypeError);
    expect(() => renderTypeId('prof', uuid.toUpperCase())).toThrow(TypeError);
  });

  test('newUuidV7 returns version 7 UUIDs in time order', () => {
    const first = newUuidV7();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newUuidV7() > first).toBe(true);
  });
});
