import { describe, expect, test } from 'vitest';
import { shopItem } from '../../test/shop-surface.ts';
import { fromWire } from '../wire/from-wire.ts';
import { toWire } from '../wire/to-wire.ts';
import type { FieldNode } from './field-node.ts';
import { generatedNodes } from './generated-action-nodes.ts';
import type { SurfaceEntity } from './surface-entity.ts';

const shown: FieldNode = {
  optional: false,
  access: 'read-write',
  kind: 'boolean',
  default: true,
};
const entity: SurfaceEntity = { ...shopItem, fields: { ...shopItem.fields, shown } };

function membersOf(node: FieldNode): Record<string, FieldNode> {
  if (node.kind !== 'shape') {
    throw new TypeError('a shape was expected');
  }
  return node.fields;
}

function patchOf(node: FieldNode): Record<string, FieldNode> {
  const patch = membersOf(node).patch;
  if (patch === undefined) {
    throw new TypeError('a patch was expected');
  }
  return membersOf(patch);
}

function updateItemOf(node: FieldNode): FieldNode {
  const update = membersOf(node).update;
  if (update === undefined || update.kind !== 'list') {
    throw new TypeError('a list was expected');
  }
  return update.item;
}

describe('the surface nodes of the generated writes', () => {
  test('the update patch members are optional and name no default', () => {
    for (const patch of [
      patchOf(generatedNodes('update', entity).input),
      patchOf(updateItemOf(generatedNodes('set', entity).input)),
    ]) {
      expect(patch.shown).toEqual({ optional: true, access: 'read-write', kind: 'boolean' });
      for (const member of Object.values(patch)) {
        expect(member.optional).toBe(true);
        expect('default' in member).toBe(false);
      }
    }
  });

  test('the create members keep their default', () => {
    expect(membersOf(generatedNodes('create', entity).input).shown).toEqual(shown);
  });

  test('fromWire of an update leaves an omitted defaulted member absent', () => {
    const nodes = generatedNodes('update', entity);
    const id = toWire(
      membersOf(nodes.input).id as FieldNode,
      '018f0000-0000-7000-8000-000000000000',
    );
    expect(fromWire(nodes.input, { id, patch: { label: 'x' } })).toEqual({
      value: { id: '018f0000-0000-7000-8000-000000000000', patch: { label: 'x' } },
    });
  });
});
