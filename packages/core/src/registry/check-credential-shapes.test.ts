import { describe, expect, test } from 'vitest';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import type { ActionEntry } from './action-entry.ts';
import { checkCredentialShapes } from './check-credential-shapes.ts';
import type { ComposableApp } from './composable-app.ts';
import type { EffectEntry } from './effect-entry.ts';
import type { Registry } from './registry.ts';

const nested = field.json(shape({ token: field.secret(), label: field.string() }));
const nestedVerifier = field.json(shape({ key: field.verifier() }));
const anySchema = {
  '~standard': { version: 1, vendor: 'test', validate: (value: unknown) => ({ value }) },
} as const;

function moduleOf(over: object = {}) {
  return {
    id: 'probe',
    base: {},
    entities: {},
    contributes: [],
    conditional: [],
    ...over,
  };
}
const appOf = (...modules: object[]) => ({ modules }) as unknown as ComposableApp;
const commandOf = (over: object): ActionEntry =>
  ({
    ref: 'probe.run',
    module: 'probe',
    kind: 'command',
    input: shape({}),
    output: shape({}),
    ...over,
  }) as unknown as ActionEntry;
const effectOf = (over: object): EffectEntry =>
  ({
    ref: 'probe.send',
    module: 'probe',
    name: 'send',
    performer: 'external',
    executor: null,
    input: shape({}),
    output: shape({}),
    ...over,
  }) as unknown as EffectEntry;
const registryOf = (
  actions: ActionEntry[] = [],
  effects: EffectEntry[] = [],
  entities: object = {},
) =>
  ({
    actions: new Map(actions.map((action) => [action.ref, action])),
    effects: new Map(effects.map((effect) => [effect.ref, effect])),
    entities: new Map(Object.entries(entities)),
  }) as unknown as Registry;
const codes = (problems: readonly { code: string }[]) => problems.map((problem) => problem.code);

describe('credentialInJson', () => {
  test('a command input', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf([commandOf({ input: shape({ settings: nested }) })]),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'credentialInJson',
        severity: 'error',
        module: 'probe',
        ref: 'probe.run',
        message: expect.stringContaining("'settings.token'"),
      }),
    ]);
  });

  test('a command output and a continuation outcome input', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf([
        commandOf({ output: shape({ settings: nested }) }),
        commandOf({ ref: 'probe.after', outcomeWith: shape({ settings: nested }) }),
      ]),
    );
    expect(codes(problems)).toEqual(['credentialInJson', 'credentialInJson']);
  });

  test('an effect input and output', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf(
        [],
        [
          effectOf({ input: shape({ settings: nested }) }),
          effectOf({ ref: 'probe.o', output: shape({ settings: nested }) }),
        ],
      ),
    );
    expect(codes(problems)).toEqual(['credentialInJson', 'credentialInJson']);
  });

  test('an entity field, also a list of json shapes, of an entity, a contribution and a conditional part', () => {
    const entities = { widget: { fields: { settings: nested, rows: field.list(nested) } } };
    const problems = checkCredentialShapes(
      appOf(
        moduleOf({
          entities,
          contributes: [
            { to: { id: 'shop' }, entities: { order: { fields: { settings: nested } } } },
          ],
          conditional: [{ entities: { widget: { fields: { settings: nested } } } }],
        }),
      ),
      registryOf(),
    );
    expect(codes(problems)).toEqual([
      'credentialInJson',
      'credentialInJson',
      'credentialInJson',
      'credentialInJson',
    ]);
    expect(problems.map((problem) => problem.ref)).toEqual([
      'probe.widget',
      'probe.widget',
      'shop.order',
      'probe.widget',
    ]);
    expect(problems[1]?.message).toContain("'rows[].token'");
  });

  test('a module configuration', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf({ base: { config: shape({ mail: nested }) } })),
      registryOf(),
    );
    expect(problems).toEqual([
      expect.objectContaining({ code: 'credentialInJson', ref: 'probe.config' }),
    ]);
  });

  test('a json member whose schema is not a keelwerk shape is not refused', () => {
    const opaque = field.json(anySchema);
    const problems = checkCredentialShapes(
      appOf(moduleOf({ entities: { widget: { fields: { opaque } } } })),
      registryOf(
        [commandOf({ input: shape({ opaque }) })],
        [effectOf({ input: shape({ opaque }) })],
      ),
    );
    expect(problems).toEqual([]);
  });
});

describe('verifierOutsideEntity', () => {
  test('a command input', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf([commandOf({ input: shape({ key: field.verifier() }) })]),
    );
    expect(problems).toEqual([
      expect.objectContaining({
        code: 'verifierOutsideEntity',
        module: 'probe',
        ref: 'probe.run',
        message: expect.stringContaining("'key'"),
      }),
    ]);
  });

  test('an effect output', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf([], [effectOf({ output: shape({ keys: field.list(field.verifier()) }) })]),
    );
    expect(codes(problems)).toEqual(['verifierOutsideEntity']);
    expect(problems[0]?.message).toContain("'keys[]'");
  });

  test('a module configuration', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf({ base: { config: shape({ key: field.verifier() }) } })),
      registryOf(),
    );
    expect(codes(problems)).toEqual(['verifierOutsideEntity']);
  });

  test('a verifier inside a json member is both problems', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf()),
      registryOf([commandOf({ input: shape({ settings: nestedVerifier }) })]),
    );
    expect(codes(problems).sort()).toEqual(['credentialInJson', 'verifierOutsideEntity']);
  });
});

describe('what composes', () => {
  const fields = {
    name: field.string(),
    password: field.secret(),
    apiKey: field.verifier(),
    keys: field.list(field.secret()),
  };
  const widget = {
    ref: 'probe.widget',
    descriptor: {
      fields: {
        name: { kind: 'string', inner: null },
        password: { kind: 'secret', inner: null },
        apiKey: { kind: 'verifier', inner: null },
      },
    },
  };

  test('an entity with secret and verifier fields, its generated update and an entity command with its row output', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf({ entities: { widget: { fields } } })),
      registryOf(
        [
          // Kernel-built: the update input holds the patch as a json shape of the entity's fields.
          commandOf({
            ref: 'probe.widget.update',
            entity: 'probe.widget',
            generated: 'update',
            input: shape({ id: field.string(), patch: field.json(shape(fields)) }),
            output: shape(fields),
          }),
          commandOf({
            ref: 'probe.widget.rotate',
            entity: 'probe.widget',
            output: shape(fields),
            entityOutput: { entity: 'probe.widget', shape: 'row' },
          }),
          commandOf({
            ref: 'probe.widget.list',
            entity: 'probe.widget',
            output: shape({ items: field.list(field.json(shape(fields))) }),
            entityOutput: { entity: 'probe.widget', shape: 'page' },
          }),
          commandOf({
            ref: 'probe.widget.touch',
            entity: 'probe.widget',
            output: shape({ name: field.string(), password: field.secret() }),
          }),
        ],
        [],
        { 'probe.widget': widget },
      ),
    );
    expect(problems).toEqual([]);
  });

  test('a declared output of an entity command that names the verifier of its entity is refused, as the default row output is not', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf({ entities: { widget: { fields } } })),
      registryOf(
        [
          commandOf({
            ref: 'probe.widget.issue',
            entity: 'probe.widget',
            output: shape({ apiKey: field.verifier() }),
          }),
        ],
        [],
        { 'probe.widget': widget },
      ),
    );
    expect(codes(problems)).toEqual(['verifierOutsideEntity']);
    expect(problems[0]?.message).toContain("'apiKey'");
  });

  test('a secret as a top-level member or as a list element composes everywhere', () => {
    const problems = checkCredentialShapes(
      appOf(moduleOf({ base: { config: shape({ key: field.secret() }) } })),
      registryOf(
        [commandOf({ input: shape({ token: field.secret(), more: field.set(field.secret()) }) })],
        [effectOf({ input: shape({ token: field.secret() }) })],
      ),
    );
    expect(problems).toEqual([]);
  });
});
