import { describe, expect, test } from 'vitest';
import type { ApiSurface } from '../surface/api-surface.ts';
import type { FieldNode } from '../surface/field-node.ts';
import type { SurfaceAction } from '../surface/surface-action.ts';
import { classifySurfaceChange } from './classify-surface-change.ts';
import { diffSurfaces } from './diff-surfaces.ts';
import { moduleVersionBump } from './module-version-bump.ts';
import type { SurfaceChangeClass, SurfaceChangeKind } from './surface-change.ts';

const text: FieldNode = { kind: 'string', optional: false, access: 'read-write' };
const optionalText: FieldNode = { ...text, optional: true };
const shapeOf = (fields: Record<string, FieldNode>): FieldNode => ({
  kind: 'shape',
  optional: false,
  access: 'read-write',
  fields,
});
const enumOf = (...values: string[]): FieldNode => ({
  kind: 'enum',
  optional: false,
  access: 'read-write',
  values,
});

function actionOf(ref: string, over: Partial<SurfaceAction> = {}): SurfaceAction {
  return {
    ref,
    module: 'library',
    name: ref.split('.').at(-1) ?? ref,
    mount: 'module',
    kind: 'command',
    instance: false,
    input: shapeOf({ title: text }),
    output: shapeOf({ id: text }),
    errors: [],
    auth: 'policy',
    scope: 'tenant',
    execution: 'sync',
    idempotent: false,
    offline: false,
    resumable: false,
    hints: {},
    since: '2026-11-04',
    changedIn: [],
    inputHash: 'in',
    outputHash: 'out',
    ...over,
  };
}

function surfaceOf(actions: readonly SurfaceAction[], over: Partial<ApiSurface> = {}): ApiSurface {
  return {
    format: 'keelwerk.surface/1',
    app: 'library',
    apiVersion: '2026-11-04',
    hash: 'sha256-x',
    modules: [{ id: 'library', version: '1.0.0' }],
    entities: [],
    actions,
    errors: [],
    events: [],
    ...over,
  };
}

function classes(base: SurfaceAction, head: SurfaceAction): readonly string[] {
  return diffSurfaces(surfaceOf([base]), surfaceOf([head])).map(
    (change) => `${change.kind}:${change.class}`,
  );
}

const add = actionOf('library.add');

describe('classifySurfaceChange (section 13.8 step 9)', () => {
  const table: readonly (readonly [SurfaceChangeKind, SurfaceChangeClass])[] = [
    ['actionRemoved', 'breaking'],
    ['outputFieldRemoved', 'breaking'],
    ['outputMadeOptional', 'breaking'],
    ['inputRequiredFieldAdded', 'breaking'],
    ['inputTypeNarrowed', 'breaking'],
    ['inputFieldRemoved', 'breaking'],
    ['inputEnumValueRemoved', 'breaking'],
    ['executionLeftSync', 'breaking'],
    ['errorKindChanged', 'breaking'],
    ['authChanged', 'breaking'],
    ['scopeChanged', 'breaking'],
    ['instanceChanged', 'breaking'],
    ['outputEnumValueAdded', 'dangerous'],
    ['outputUnionMemberAdded', 'dangerous'],
    ['declaredErrorAdded', 'dangerous'],
    ['actionAdded', 'additive'],
    ['outputFieldAdded', 'additive'],
    ['inputOptionalFieldAdded', 'additive'],
    ['moduleChanged', 'neutral'],
    ['metadataChanged', 'neutral'],
  ];
  test.each(table)('%s is %s', (kind, expected) => {
    expect(classifySurfaceChange(kind)).toBe(expected);
  });
});

describe('diffSurfaces', () => {
  test('identical surfaces differ in nothing', () => {
    expect(diffSurfaces(surfaceOf([add]), surfaceOf([add]))).toEqual([]);
  });

  test('a moved part file, which renames its action, removes the old one: breaking', () => {
    const changes = diffSurfaces(surfaceOf([add]), surfaceOf([actionOf('library.catalog.add')]));
    expect(changes.map((change) => [change.ref, change.class])).toEqual([
      ['library.add', 'breaking'],
      ['library.catalog.add', 'additive'],
    ]);
  });

  test('an output field removed, made optional or added', () => {
    expect(classes(add, actionOf('library.add', { output: shapeOf({}) }))).toEqual([
      'outputFieldRemoved:breaking',
    ]);
    expect(
      classes(add, actionOf('library.add', { output: shapeOf({ id: optionalText }) })),
    ).toEqual(['outputMadeOptional:breaking']);
    expect(
      classes(add, actionOf('library.add', { output: shapeOf({ id: text, extra: text }) })),
    ).toEqual(['outputFieldAdded:additive']);
  });

  test('a new input field is breaking when required, additive when optional or defaulted', () => {
    expect(
      classes(add, actionOf('library.add', { input: shapeOf({ title: text, isbn: text }) })),
    ).toEqual(['inputRequiredFieldAdded:breaking']);
    expect(
      classes(
        add,
        actionOf('library.add', { input: shapeOf({ title: text, isbn: optionalText }) }),
      ),
    ).toEqual(['inputOptionalFieldAdded:additive']);
    expect(
      classes(
        add,
        actionOf('library.add', {
          input: shapeOf({ title: text, isbn: { ...text, default: 'x' } }),
        }),
      ),
    ).toEqual(['inputOptionalFieldAdded:additive']);
  });

  test('an input narrowed or an enum value removed is breaking; widened or added is additive', () => {
    const wide = actionOf('library.add', {
      input: shapeOf({ title: { ...text, maxLength: 200 } }),
    });
    const narrow = actionOf('library.add', {
      input: shapeOf({ title: { ...text, maxLength: 100 } }),
    });
    expect(classes(wide, narrow)).toEqual(['inputTypeNarrowed:breaking']);
    expect(classes(narrow, wide)).toEqual(['inputTypeWidened:additive']);
    const two = actionOf('library.add', { input: shapeOf({ kind: enumOf('a', 'b') }) });
    const one = actionOf('library.add', { input: shapeOf({ kind: enumOf('a') }) });
    expect(classes(two, one)).toEqual(['inputEnumValueRemoved:breaking']);
    expect(classes(one, two)).toEqual(['inputEnumValueAdded:additive']);
  });

  test('an output enum value added is dangerous, so exhaustive clients can handle it', () => {
    const one = actionOf('library.add', { output: shapeOf({ state: enumOf('a') }) });
    const two = actionOf('library.add', { output: shapeOf({ state: enumOf('a', 'b') }) });
    expect(classes(one, two)).toEqual(['outputEnumValueAdded:dangerous']);
  });

  test('a union member added to an output schema is dangerous; any other schema change is breaking', () => {
    const json = (schema: Record<string, unknown>): FieldNode => ({
      kind: 'json',
      optional: false,
      access: 'read-write',
      schema,
    });
    const out = (schema: Record<string, unknown>): SurfaceAction =>
      actionOf('library.add', { output: shapeOf({ data: json(schema) }) });
    const a = { type: 'string' };
    const b = { type: 'number' };
    expect(classes(out({ anyOf: [a] }), out({ anyOf: [a, b] }))).toEqual([
      'outputUnionMemberAdded:dangerous',
    ]);
    expect(classes(out({ anyOf: [a, b] }), out({ anyOf: [a] }))).toEqual([
      'outputSchemaChanged:breaking',
    ]);
  });

  test('an execution mode changed away from sync is breaking', () => {
    expect(classes(add, actionOf('library.add', { execution: 'async' }))).toEqual([
      'executionLeftSync:breaking',
    ]);
    expect(classes(add, actionOf('library.add', { execution: 'either' }))).toEqual([
      'executionLeftSync:breaking',
    ]);
    expect(classes(actionOf('library.add', { execution: 'async' }), add)).toEqual([
      'executionChanged:additive',
    ]);
  });

  test('an error code given another kind is breaking; a new declared error is dangerous', () => {
    const error = (kind: 'conflict' | 'validation') => ({
      code: 'library.taken',
      kind,
      message: 'taken',
      retryable: false,
    });
    const changes = diffSurfaces(
      surfaceOf([add], { errors: [error('conflict')] }),
      surfaceOf([actionOf('library.add', { errors: ['library.taken'] })], {
        errors: [error('validation')],
      }),
    );
    expect(changes.map((change) => `${change.kind}:${change.class}`)).toEqual([
      'declaredErrorAdded:dangerous',
      'errorKindChanged:breaking',
    ]);
  });

  test('a module version change is neutral and asks for the bump it deserves', () => {
    const changes = diffSurfaces(
      surfaceOf([add]),
      surfaceOf([add], { modules: [{ id: 'library', version: '1.0.1' }] }),
    );
    expect(changes.map((change) => change.class)).toEqual(['neutral']);
  });
});

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

describe('moduleVersionBump (section 18.6)', () => {
  const breaking = diffSurfaces(surfaceOf([add]), surfaceOf([]));
  const additive = diffSurfaces(surfaceOf([]), surfaceOf([add]));
  const neutral = diffSurfaces(
    surfaceOf([add]),
    surfaceOf([add], { modules: [{ id: 'library', version: '2.0.0' }] }),
  );

  test('breaking needs a major, additive a minor, neutral a patch', () => {
    expect(moduleVersionBump('1.2.3', '1.3.0', breaking)).toMatchObject({
      required: 'major',
      ok: false,
    });
    expect(moduleVersionBump('1.2.3', '2.0.0', breaking)).toMatchObject({
      required: 'major',
      ok: true,
    });
    expect(moduleVersionBump('1.2.3', '1.2.4', additive)).toMatchObject({
      required: 'minor',
      ok: false,
    });
    expect(moduleVersionBump('1.2.3', '1.3.0', additive).ok).toBe(true);
    expect(moduleVersionBump('1.2.3', '1.2.4', neutral)).toMatchObject({
      required: 'patch',
      ok: true,
    });
  });

  test('no change needs no bump, and a version that went down never fits', () => {
    expect(moduleVersionBump('1.2.3', '1.2.3', [])).toEqual({
      required: 'none',
      actual: 'none',
      ok: true,
    });
    expect(moduleVersionBump('2.0.0', '1.9.0', neutral).ok).toBe(false);
    expect(moduleVersionBump('2.0.0', '1.9.0', []).ok).toBe(false);
  });
});
