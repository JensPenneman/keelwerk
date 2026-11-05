import { describe, expect, test } from 'vitest';
import { actionOf, add, classes, shapeOf, surfaceOf, text } from '../../test/surface-kit.ts';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { FieldNode } from '../surface/field-node.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';
import { diffSurfaces } from './diff-surfaces.ts';

describe('diffSurfaces fails closed on what clients rely on', () => {
  const change = (over: Partial<SurfaceAction>): readonly string[] =>
    classes(add, actionOf('library.add', over));

  test('an input field removed is breaking, since the wire refuses unknown members', () => {
    expect(classes(add, actionOf('library.add', { input: shapeOf({}) }))).toEqual([
      'inputFieldRemoved:breaking',
    ]);
  });

  test('a wide integer is a different type in both directions', () => {
    const integer = (wide: boolean): FieldNode => ({
      kind: 'integer',
      optional: false,
      access: 'read-write',
      wide,
    });
    const withInteger = (wide: boolean, side: 'input' | 'output'): SurfaceAction =>
      actionOf('library.add', { [side]: shapeOf({ n: integer(wide) }) });
    expect(classes(withInteger(false, 'input'), withInteger(true, 'input'))).toEqual([
      'inputTypeChanged:breaking',
    ]);
    expect(classes(withInteger(false, 'output'), withInteger(true, 'output'))).toEqual([
      'outputTypeChanged:breaking',
    ]);
  });

  test('a smaller decimal scale narrows the input', () => {
    const decimal = (scale: number): FieldNode => ({
      kind: 'decimal',
      optional: false,
      access: 'read-write',
      scale,
    });
    const withScale = (scale: number): SurfaceAction =>
      actionOf('library.add', { input: shapeOf({ price: decimal(scale) }) });
    expect(classes(withScale(4), withScale(2))).toEqual(['inputTypeNarrowed:breaking']);
    expect(classes(withScale(2), withScale(4))).toEqual(['inputTypeWidened:additive']);
  });

  test('removing the default of a required-by-default input field makes it required', () => {
    const defaulted = actionOf('library.add', {
      input: shapeOf({ title: { ...text, default: 'x' } }),
    });
    expect(classes(defaulted, add)).toEqual(['inputMadeRequired:breaking']);
    expect(classes(add, defaulted)).toEqual(['inputMadeOptional:additive']);
  });

  test('an output field that becomes write-only is no longer readable', () => {
    const hidden = actionOf('library.add', {
      output: shapeOf({ id: { ...text, access: 'write' } }),
    });
    expect(classes(add, hidden)).toEqual(['outputFieldRemoved:breaking']);
  });

  test('auth, scope and instance changes are breaking', () => {
    expect(change({ auth: 'public' })).toEqual(['authChanged:breaking']);
    expect(change({ scope: 'backend' })).toEqual(['scopeChanged:breaking']);
    expect(change({ instance: true })).toEqual(['instanceChanged:breaking']);
  });

  test('a scope widened to invocation still accepts the old scope and is not breaking', () => {
    const tenant = actionOf('library.add', { scope: 'tenant' });
    expect(classes(tenant, actionOf('library.add', { scope: 'invocation' }))).toEqual([
      'metadataChanged:neutral',
    ]);
    expect(classes(actionOf('library.add', { scope: 'invocation' }), tenant)).toEqual([
      'scopeChanged:breaking',
    ]);
  });

  test('mount and idempotent changes are reported as metadata', () => {
    expect(change({ mount: 'app' })).toEqual(['metadataChanged:neutral']);
    expect(change({ idempotent: true })).toEqual(['metadataChanged:neutral']);
  });

  test('an event gaining or losing data is reported', () => {
    const event = (data?: FieldNode) => ({
      entity: 'library.book',
      name: 'moved',
      generated: false,
      ...(data === undefined ? {} : { data }),
    });
    const withEvent = (data?: FieldNode): ApiSurface => surfaceOf([], { events: [event(data)] });
    const kinds = (base: ApiSurface, head: ApiSurface) =>
      diffSurfaces(base, head).map((item) => `${item.kind}:${item.class}`);
    expect(kinds(withEvent(), withEvent(shapeOf({})))).toEqual(['outputFieldAdded:additive']);
    expect(kinds(withEvent(shapeOf({})), withEvent())).toEqual(['outputFieldRemoved:breaking']);
  });

  test('an error whose data or retryable flag changes is reported as metadata', () => {
    const error = (over: { retryable?: boolean; data?: FieldNode }) => ({
      code: 'library.taken',
      kind: 'conflict' as const,
      message: 'taken',
      retryable: false,
      ...over,
    });
    const kinds = (head: ReturnType<typeof error>) =>
      diffSurfaces(surfaceOf([], { errors: [error({})] }), surfaceOf([], { errors: [head] })).map(
        (item) => `${item.kind}:${item.class}`,
      );
    expect(kinds(error({ retryable: true }))).toEqual(['metadataChanged:neutral']);
    expect(kinds(error({ data: shapeOf({}) }))).toEqual(['metadataChanged:neutral']);
  });
});
