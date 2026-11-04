import { defineEntity, type EntityType, field } from '@keelwerk/core';

const connectionDef = defineEntity({
  prefix: 'ghc',
  fields: {
    accountLogin: field.string({ maxLength: 80 }),
    tokenLast4: field.string({ maxLength: 4 }),
    scopes: field.string({ maxLength: 200 }),
    state: field.string({ maxLength: 64 }).unique(),
  },
  generated: {
    get: false,
    query: false,
    changes: false,
    queryChanges: false,
    set: false,
    history: false,
    watch: false,
  },
});

export interface Connection extends EntityType<typeof connectionDef> {}
export const connection: Connection = connectionDef;
