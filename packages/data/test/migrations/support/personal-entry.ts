import type { EntityEntry } from '@keelwerk/core';
import {
  buildRegistry,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  field,
} from '@keelwerk/core';

const person = defineEntity({
  prefix: 'prs',
  tenancy: 'backend',
  dataSubject: 'owner',
  fields: {
    owner: field.subject(),
    email: field
      .string({ maxLength: 120 })
      .personal({ queries: ['eq', 'prefix', 'contains'], normalize: 'email' })
      .unique(),
    body: field.richText().optional(),
    price: field.decimal({ precision: 10, scale: 2 }).optional(),
  },
});

const people = defineModule(
  defineModuleBase({ id: 'people', version: '0.1.0', entities: { person } } as never),
  {},
) as never;

const registry = buildRegistry({
  kind: 'app',
  id: 'people-app',
  modules: [...defineApp({ id: 'seed', modules: [] }).modules, people],
  execution: {},
  appActions: {},
  authorization: {},
  policies: {},
  api: null,
});

const found = registry.entities.get('people.person');
if (found === undefined) throw new Error('the registry built no people.person');

/** A backend-scoped entity with a personal e-mail field, a CRDT body and a decimal, built through the registry. */
export const personalEntry: EntityEntry = found;
