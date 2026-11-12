import {
  defineApiVersions,
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  defineVersionChange,
  field,
  type ModuleBaseType,
  type ModuleType,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';

const person = defineEntity({
  prefix: 'psn',
  fields: { displayName: field.string({ maxLength: 100 }) },
});

interface PeopleBase extends ModuleBaseType<typeof peopleBaseDef> {}

const peopleBaseDef = defineModuleBase({
  id: 'people',
  version: '1.0.0',
  entities: { person },
});
const peopleBase: PeopleBase = peopleBaseDef;

/** The head names the field `displayName`; the older version called it `name`. */
const renamed = defineVersionChange(peopleBase, {
  since: '1.0.0',
  surface: [{ entity: person, field: 'displayName', renamedFrom: 'name' }],
  fixtures: [
    { ref: 'people.person.create', older: { name: 'Ada' }, newer: { displayName: 'Ada' } },
  ],
});

const peopleDef = defineModule(peopleBase, {
  policies: {
    person: {
      users: defineRule(peopleBase, person, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
        reason: 'A signed-in user reads and edits people.',
      }),
    },
  },
  changes: { renamed },
});

interface People extends ModuleType<typeof peopleDef> {}
const people: People = peopleDef;

/** The API version before and at the head of `renamedPeopleApp`. */
export const peopleVersions = { older: '2026-11-04', head: '2026-11-11' } as const;

/** An app with the live module and one entity, `people.person`, whose `displayName` was `name` at the older version. */
export const renamedPeopleApp = defineApp({
  id: 'renamed-people',
  modules: [live, people],
  api: defineApiVersions({
    [peopleVersions.older]: {},
    [peopleVersions.head]: { changes: ['people.renamed'] },
  }),
});
