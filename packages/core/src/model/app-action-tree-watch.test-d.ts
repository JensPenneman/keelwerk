import { describe, expectTypeOf, test } from 'vitest';
import { contracts } from '../dsl/contracts.ts';
import { defineApp } from '../dsl/define-app.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineModule } from '../dsl/define-module.ts';
import { defineModuleBase } from '../dsl/define-module-base.ts';
import { field } from '../fields/field.ts';
import type { WatchInput } from '../live/watch-input.ts';
import type { AppActionTree } from './app-action-tree.ts';
import type { EntityChange } from './entity-change.ts';
import type { Readable } from './readable.ts';
import type { Where } from './where.ts';

const live = defineModule(
  defineModuleBase({
    id: 'live',
    version: '0.1.0',
    provides: [contracts.live],
    generates: ['watch'],
  }),
  {},
);

const views = defineModule(
  defineModuleBase({
    id: 'views',
    version: '0.1.0',
    entities: {
      stat: defineEntity({
        prefix: 'stat',
        fields: { total: field.integer(), secret: field.string().hidden() },
        history: 'projection',
      }),
    },
  }),
  {},
);

const app = defineApp({ id: 'watch-types', modules: [views, live] });
type Watch = AppActionTree<typeof app>['views']['entities']['stat']['watch'];
type Row = Readable<typeof app, 'views.stat'>;

describe('the generated watch of an entity', () => {
  test('watch input is WatchInput with a typed filter', () => {
    expectTypeOf<Watch['input']>().toEqualTypeOf<WatchInput<Where<Row>>>();
    // @ts-expect-error `since` was M1's member; the resume member is `after`
    const bad: Watch['input'] = { since: 'x' };
    expectTypeOf(bad).not.toBeAny();
  });

  test('watch events are EntityChange of the readable row', () => {
    expectTypeOf<Watch['events']>().toEqualTypeOf<EntityChange<Row>>();
    expectTypeOf<Row>().not.toHaveProperty('secret');
    type Removed = Extract<EntityChange<Row>, { type: 'removed' }>;
    expectTypeOf<Removed>().not.toHaveProperty('row');
  });
});
