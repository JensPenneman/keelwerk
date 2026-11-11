import { defineVersionChange } from '../src/api-versions/define-version-change.ts';
import { defineApiVersions } from '../src/dsl/define-api-versions.ts';
import { defineCommand } from '../src/dsl/define-command.ts';
import { defineEntity } from '../src/dsl/define-entity.ts';
import { defineError } from '../src/errors/define-error.ts';
import { field } from '../src/fields/field.ts';
import { relation } from '../src/fields/relation.ts';
import { shape } from '../src/fields/shape.ts';
import { buildRegistry } from '../src/registry/build-registry.ts';
import type { ComposableApp } from '../src/registry/composable-app.ts';
import type { Registry } from '../src/registry/registry.ts';
import { appOf, makeModule } from './registry-kit.ts';

const shelfBase = { id: 'shelf', version: '2.0.0' } as const;

export const shelfItem = defineEntity({
  prefix: 'itm',
  fields: {
    label: field.string(),
    size: field.integer().default(1),
    rackId: field.string().optional(),
    note: field.string().optional().maskable(),
    meta: field.json(shape({ title: field.string().optional() })).optional(),
  },
});
export const shelfRack = defineEntity({
  prefix: 'rck',
  fields: { name: field.string() },
  relations: { items: relation.many.own('item', { by: 'rackId', to: 'id' }) },
});

export const full = defineError('shelf.full', { kind: 'conflict', message: 'The shelf is full.' });
export const place = defineCommand(
  shelfBase as never,
  {
    input: shape({}),
    output: shape({}),
    errors: [full],
    decide: () => ({ events: [] }),
  } as never,
);

/** The four kinds of change on one module: a rename, an added required field, a removed field, a renamed action with a renamed error code. */
export const changes = {
  labelRename: defineVersionChange(
    shelfBase as never,
    {
      since: '2.0.0',
      surface: [{ entity: shelfItem, field: 'label', renamedFrom: 'title' }],
    } as never,
  ),
  sizeAdded: defineVersionChange(
    shelfBase as never,
    {
      since: '2.0.0',
      surface: [{ entity: shelfItem, field: 'size', addedRequired: true }],
    } as never,
  ),
  colourRemoved: defineVersionChange(
    shelfBase as never,
    {
      since: '2.0.0',
      surface: [{ entity: shelfItem, field: 'colour', removed: true }],
      output: {
        'shelf.item.get': (value: unknown) => {
          const page = value as { readonly list: readonly object[] };
          return { ...page, list: page.list.map((row) => ({ ...row, colour: 'grey' })) };
        },
      },
    } as never,
  ),
  placeRename: defineVersionChange(
    shelfBase as never,
    {
      since: '2.0.0',
      surface: [{ action: 'shelf.place', renamedFrom: 'shelf.put' }],
      errors: { 'shelf.full': 'shelf.no_room' },
    } as never,
  ),
};

export const changeIds = Object.keys(changes).map((key) => `shelf.${key}`);

export const shelf = makeModule(
  { ...shelfBase, entities: { item: shelfItem, rack: shelfRack } },
  { actions: { place }, changes },
);

/** Two declared versions: the older adopts nothing, the head adopts the given change ids. */
export function shelfApi(headChanges: readonly string[] = changeIds) {
  return defineApiVersions({ '2026-11-04': {}, '2026-11-11': { changes: headChanges } });
}

/** The shelf app, composed without `defineApp`'s checks, and its registry. */
export function shelfApp(options: Partial<ComposableApp> = {}): {
  readonly app: ComposableApp;
  readonly registry: Registry;
} {
  const app = appOf([shelf], { api: shelfApi(), ...options });
  return { app, registry: buildRegistry(app) };
}
