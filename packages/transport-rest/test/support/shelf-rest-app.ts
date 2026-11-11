import {
  type AppType,
  defineApiVersions,
  defineApp,
  defineCommand,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineVersionChange,
  errors,
  field,
  relation,
  shape,
} from '@keelwerk/core';
import { rest } from '@keelwerk/transport-rest';

const item = defineEntity({
  prefix: 'itm',
  fields: {
    label: field.string(),
    size: field.integer().default(1),
    parent: field.ref.own('item').optional(),
    container: field.ref.own('item').optional(),
    shelvedOn: field.date().optional(),
    addedAt: field.instant().optional(),
  },
  relations: { notes: relation.many.own('note', { by: 'item', to: 'id' }) },
});
/** An entity no version change touches, with a reference to the one they do. */
const note = defineEntity({
  prefix: 'nte',
  fields: { text: field.string(), item: field.ref.own('item') },
});
const base = defineModuleBase({ id: 'shelf', version: '2.0.0', entities: { item, note } });

/** Refuses with issues that name head fields, the way a `decide` does: past the translation. */
const claim = defineCommand(base, item, {
  input: shape({ label: field.string(), size: field.integer() }),
  principal: 'user',
  decide: () => {
    throw errors.validation('The claim is refused.', {
      issues: [
        { path: ['label'], message: 'is taken' },
        { path: ['size'], message: 'is too small' },
      ],
    });
  },
});

const shelf = defineModule(base, {
  entityActions: { item: { claim } },
  changes: {
    labelRename: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'label', renamedFrom: 'title' }],
    }),
    containerRename: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'container', renamedFrom: 'box' }],
    }),
    sizeAdded: defineVersionChange(base, {
      since: '2.0.0',
      surface: [{ entity: item, field: 'size', addedRequired: true }],
    }),
  },
  policies: {
    item: {
      editors: defineRule(base, item, {
        effect: 'allow',
        actions: ['read', 'write', 'claim'],
        principal: 'user',
      }),
    },
    note: {
      editors: defineRule(base, note, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
      }),
    },
  },
});

const definition = defineApp({
  id: 'shelves',
  modules: [shelf, rest],
  api: defineApiVersions({
    '2026-11-04': {},
    '2026-11-11': { changes: ['shelf.labelRename', 'shelf.containerRename', 'shelf.sizeAdded'] },
  }),
});

/** A shelf whose version changes rename `label` and `container` and add `size`, with a command that refuses past the translation. */
export interface ShelfWithRest extends AppType<typeof definition> {}
export const shelfWithRest: ShelfWithRest = definition;
