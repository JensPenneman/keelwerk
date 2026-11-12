import { describe, expect, test } from 'vitest';
import { fieldNodeOf } from '../surface/field-node-of.ts';
import { patchMemberOf } from '../surface/patch-member-of.ts';
import { field } from './field.ts';
import type { AnyField } from './field-def.ts';
import { patchFieldOf } from './patch-field-of.ts';

const context = { declaredBy: 'shelf', tag: 1, prefixOf: () => undefined };

describe('the field of a patch member', () => {
  test.each([
    ['a string with a default', field.string().default('x')],
    ['a boolean with a default', field.boolean().default(true)],
    ['an integer with a default', field.integer().default(5)],
    ['an enum with a default', field.enum(['a', 'b']).default('a')],
    ['a list with a default', field.list(field.string()).default([])],
    ['an optional instant', field.instant().optional()],
  ])('%s has the node of patchMemberOf', (_name, member) => {
    expect(fieldNodeOf(patchFieldOf(member), context)).toEqual(
      patchMemberOf(fieldNodeOf(member, context)),
    );
  });

  test.each([
    ['optional', (patch: AnyField) => patch.optional()],
    ['default', (patch: AnyField) => patch.default('y')],
    ['unique', (patch: AnyField) => patch.unique()],
    ['index', (patch: AnyField) => patch.index()],
    ['hidden', (patch: AnyField) => patch.hidden()],
    ['maskable', (patch: AnyField) => patch.maskable()],
    ['personal', (patch: AnyField) => patch.personal()],
    ['stateOnly', (patch: AnyField) => patch.stateOnly()],
    ['merge', (patch: AnyField) => patch.merge('exclusive')],
    ['tag', (patch: AnyField) => patch.tag(3)],
    ['describe', (patch: AnyField) => patch.describe('text')],
    ['deprecated', (patch: AnyField) => patch.deprecated('old')],
  ])(
    'the builder method %s of a patch member is an internal error, not a rebuilt default',
    (_name, call) => {
      const patch = patchFieldOf(field.string().default('x'));
      expect(() => call(patch)).toThrow(
        expect.objectContaining({
          kind: 'internal',
          message: expect.stringContaining('not rebuilt'),
        }),
      );
    },
  );
});
