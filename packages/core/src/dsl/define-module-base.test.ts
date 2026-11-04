import { describe, expect, it } from 'vitest';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import { field } from '../fields/field.ts';
import { defineEntity } from './define-entity.ts';
import { defineModuleBase } from './define-module-base.ts';

const clash = 'foo' + 'BAR';
const entity = defineEntity({ prefix: 'a', fields: { x: field.string() } });

describe('defineModuleBase entity names (section 14.4.2)', () => {
  it('refuses an entity key with consecutive capitals as invalidEntityName', () => {
    try {
      defineModuleBase({ id: 'm', version: '1.0.0', entities: { [clash]: entity } });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(KeelwerkError);
      expect((error as KeelwerkError).details).toMatchObject({
        code: 'invalidEntityName',
        severity: 'error',
        module: 'm',
        ref: 'm.fooBAR',
      });
    }
  });

  it('accepts camelCase entity keys', () => {
    expect(() =>
      defineModuleBase({ id: 'm', version: '1.0.0', entities: { fooBar: entity } }),
    ).not.toThrow();
  });
});
