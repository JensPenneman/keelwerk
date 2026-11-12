import { defineEntity, type EntityType, field } from '@keelwerk/core';

const keyDef = defineEntity({
  prefix: 'akey',
  dataSubject: 'subject',
  history: 'state',
  reason: 'Keys are issued and revoked, never edited; last use moves hourly and needs no history.',
  fields: {
    /** The owner, a data subject (14.7.4): an erasure of the owner reaches the key. */
    subject: field.subject().index(),
    /** The owner principal's `subjectRef` at creation, so a key principal answers `subjectAs` as its owner's does. */
    subjectRef: field.string().optional(),
    publicId: field.string().unique(),
    verifier: field.verifier(),
    /** Free text a person writes: personal. */
    label: field.string({ minLength: 1, maxLength: 120 }).personal(),
    scopes: field.list(field.string({ pattern: '^(read|write|transport:[a-z][a-z0-9-]{0,62})$' })),
    expiresAt: field.instant().optional(),
    apiVersion: field.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }).optional(),
    lastUsedAt: field.instant().optional(),
    revokedAt: field.instant().optional(),
  },
  generated: { set: false },
});

export interface Key extends EntityType<typeof keyDef> {}
export const key: Key = keyDef;
