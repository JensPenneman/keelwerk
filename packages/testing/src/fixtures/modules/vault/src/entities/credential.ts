import { defineEntity, type EntityType, field } from '@keelwerk/core';

const credentialDef = defineEntity({
  prefix: 'cred',
  fields: {
    label: field.string({ maxLength: 100 }),
    apiKey: field.secret().optional(),
    publicId: field.string({ maxLength: 40 }).optional(),
    tokenVerifier: field.verifier().optional(),
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

export interface Credential extends EntityType<typeof credentialDef> {}
export const credential: Credential = credentialDef;
