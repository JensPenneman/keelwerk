import { describe, expect, it } from 'vitest';
import { sha256 } from '../crypto/sha256.ts';
import { physicalColumnName } from './physical-column-name.ts';
import { physicalTableName } from './physical-table-name.ts';

describe('physical names', () => {
  it('maps module tables and columns to snake case', () => {
    expect(physicalTableName('accounts', 'profile')).toBe('accounts__profile');
    expect(physicalTableName('api-keys', 'apiKey')).toBe('api_keys__api_key');
    expect(physicalTableName('accounts', 'profile', { suffix: 'fts' })).toBe(
      'accounts__profile__fts',
    );
    expect(physicalColumnName('displayName')).toBe('display_name');
    expect(physicalColumnName('email')).toBe('email');
  });

  it('truncates at 63 bytes with 8 hexadecimal characters of the full name hash', () => {
    const field = `${'a'.repeat(70)}`;
    const name = physicalColumnName(field);
    expect(name).toHaveLength(63);
    expect(name).toBe(`${'a'.repeat(55)}${sha256(field).slice(0, 8)}`);
    expect(physicalColumnName('a'.repeat(63))).toBe('a'.repeat(63));
    const table = physicalTableName('accounts', `${'b'.repeat(60)}`);
    expect(table).toHaveLength(63);
    expect(table.endsWith(sha256(`accounts__${'b'.repeat(60)}`).slice(0, 8))).toBe(true);
  });

  it('keeps long names distinct and honours another limit', () => {
    expect(physicalColumnName(`${'a'.repeat(70)}X`)).not.toBe(
      physicalColumnName(`${'a'.repeat(70)}Y`),
    );
    expect(physicalColumnName('a'.repeat(70), { maxLength: 64 })).toHaveLength(64);
  });
});
