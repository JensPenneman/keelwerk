import { describe, expect, test } from 'vitest';
import { appOf, makeModule, shopBase, widget } from '../../test/registry-kit.ts';
import { defineQuery } from '../dsl/define-query.ts';
import { pageOf } from '../dsl/page-of.ts';
import { rowOf } from '../dsl/row-of.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';

const read = (): undefined => undefined;
const one = defineQuery(shopBase as never, { output: rowOf(widget), read } as never);
const list = defineQuery(shopBase as never, { output: pageOf(widget), read } as never);
const custom = defineQuery(
  shopBase as never,
  {
    output: shape({ n: field.integer() }),
    read,
  } as never,
);
const registry = buildRegistry(
  appOf([makeModule({ id: 'shop', entities: { widget } }, { actions: { one, list, custom } })]),
);

describe('the entity output marker of an action entry (sections 9.2 and 16.2.2)', () => {
  test('rowOf marks one row and pageOf a page, both naming the entity', () => {
    expect(registry.actions.get('shop.one')?.entityOutput).toEqual({
      entity: 'shop.widget',
      shape: 'row',
    });
    expect(registry.actions.get('shop.list')?.entityOutput).toEqual({
      entity: 'shop.widget',
      shape: 'page',
    });
  });

  test('a custom output has no marker', () => {
    expect(registry.actions.get('shop.custom')?.entityOutput).toBeUndefined();
  });

  test('the generated writes mark the entity row; the generated reads do not', () => {
    expect(registry.actions.get('shop.widget.create')?.entityOutput).toEqual({
      entity: 'shop.widget',
      shape: 'row',
    });
    expect(registry.actions.get('shop.widget.query')?.entityOutput).toBeUndefined();
  });
});
