import { describe, expect, it } from 'vitest';
import { defineEntity } from '../dsl/define-entity.ts';
import { field } from '../fields/field.ts';
import { physicalColumnName } from './physical-column-name.ts';

const clash = 'foo' + 'BAR';

describe('physical name collisions (section 14.4.2)', () => {
  it('maps fooBar and fooBAR to one column, which is why defineEntity refuses the second', () => {
    expect(physicalColumnName('fooBar')).toBe(physicalColumnName(clash));
    expect(() =>
      defineEntity({ prefix: 'a', fields: { fooBar: field.string(), [clash]: field.string() } }),
    ).toThrow(/invalidFieldName/);
  });
});
