import { describe, expect, test } from 'vitest';
import type { FieldNode } from './field-node.ts';
import { hasProjectableInput } from './has-projectable-input.ts';

function actionWith(kind: string): { readonly input: FieldNode } {
  return { input: { kind } as unknown as FieldNode };
}

describe('hasProjectableInput', () => {
  test('a shape, a foreign schema and void are projectable; other input kinds are not (S-153)', () => {
    for (const kind of ['shape', 'foreign', 'void']) {
      expect(hasProjectableInput(actionWith(kind)), kind).toBe(true);
    }
    for (const kind of ['string', 'list', 'json', 'enum', 'page']) {
      expect(hasProjectableInput(actionWith(kind)), kind).toBe(false);
    }
  });
});
