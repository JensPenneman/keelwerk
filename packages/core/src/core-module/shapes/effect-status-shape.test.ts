import { describe, expect, it } from 'vitest';
import { nodeOf } from '../../../test/field-node-kit.ts';
import { errorKinds } from '../../errors/error-kinds.ts';
import { effectStatusShape } from './effect-status-shape.ts';

describe('effectStatusShape', () => {
  it("the error's kind is published as an enum of every error kind", () => {
    const node = nodeOf(effectStatusShape.fields.error);
    expect(node.kind).toBe('json');
    if (node.kind !== 'json') return;
    for (const schema of [node.schema, node.input, node.output]) {
      const properties = (schema as { properties: { kind: { enum: unknown } } }).properties;
      expect(properties.kind.enum).toEqual([...errorKinds]);
    }
  });
});
