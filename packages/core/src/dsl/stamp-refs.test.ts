import { describe, expect, it } from 'vitest';
import type { AnyModuleBase } from '../model/any-module-base.ts';
import type { ModuleLiteral } from '../model/module-literal.ts';
import { stampRefs } from './stamp-refs.ts';

describe('stampRefs on policies', () => {
  it('references an entity rule by entity and a module-level rule by module', () => {
    const base = { id: 'library' } as unknown as AnyModuleBase;
    const entityRule = { kind: 'rule' };
    const moduleRule = { kind: 'rule' };
    const literal = {
      policies: { book: { readers: entityRule }, signedIn: moduleRule },
    } as unknown as ModuleLiteral;
    stampRefs(base, literal);
    expect(Reflect.get(entityRule, 'ref')).toBe('library.book.readers');
    expect(Reflect.get(moduleRule, 'ref')).toBe('library.signedIn');
  });
});
