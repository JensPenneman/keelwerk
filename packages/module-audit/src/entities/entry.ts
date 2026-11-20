import { defineEntity, type EntityType, field } from '@keelwerk/core';

/**
 * One entry per event of a tenant (G12). An entry holds a personal value (the address and the agent
 * of the request) and a data subject, so the rules of erasure and retention apply:
 * - Erasure of the subject (14.7.5) tombstones every entry that names it and destroys the key that
 *   seals the address and the agent. An event whose subject was erased before its job ran gets no
 *   entry: the kernel decides nothing for it, also for an event of an anonymous actor whose row was
 *   erased (sign-up, login). Proved by erasure.test.ts (both tests: the tombstone, and the held job of
 *   a subject with no key) and by with-accounts.test.ts (the held jobs of a sign-up).
 * - Retention (WP-96) purges receipts and job history only; it never purges an entry. The entry copied
 *   the request when its job ran, so the purge of the receipt takes nothing from it. A job that runs
 *   after the receipt was purged writes an entry without request metadata. Proved by retention.test.ts.
 * - Nothing derived from a secret, a credential, a cookie, a token or the input of a command is
 *   written: the entry is built from the named members of the event, never from its data. Proved by
 *   secrecy.test.ts.
 *
 * - Integrity: no caller action can write an entry, because the entity mounts none of create, update,
 *   archive or restore. The deny rule `noWrites` is the visible rule that still holds if a later
 *   change mounts one: it refuses all four to every principal kind, so a policy override that allows
 *   `*` on the entry cannot write one, and only disabling the rule by its id would then open it. The
 *   reaction's own write is the module's mounted action, which checks no entity rule. Proved by
 *   integrity.test.ts.
 *   A contribution to `audit.entry` is outside this protection: a module that depends on audit and
 *   contributes a field to the entry may update that field through module authority, which bypasses
 *   rules, and a contributed unique field can make later entries conflict.
 *
 * Not recorded (7.7): an event of deployment scope, an event of a process stream, an event of backend
 * scope (an entry is tenant-only), and the transient records of the entities with `history: 'state'`
 * (a logout, a session revocation, a reset token). A module that wants an action of such an entity
 * audited emits a durable event on a chain entity, as auth does with `auth.credential.loggedIn`.
 */
const entryDef = defineEntity({
  prefix: 'aud',
  dataSubject: 'subject',
  fields: {
    eventId: field.string().unique(),
    eventType: field.string(),
    streamType: field.string(),
    streamId: field.string(),
    streamVersion: field.integer(),
    at: field.instant(),
    action: field.string().optional(),
    commandId: field.string().optional(),
    causationId: field.string().optional(),
    actorKind: field.enum(['anonymous', 'user', 'service', 'operator', 'system']),
    actorVia: field.string(),
    /** A service id or an operator principal id; never the subject of a user. */
    actorId: field.string().optional(),
    /** The data subject the event's request came from (`ObservedEvent.subject`). */
    subject: field.subject().optional().index(),
    transport: field.string().optional(),
    remoteAddress: field.string({ maxLength: 64 }).optional().personal(),
    userAgent: field.string({ maxLength: 512 }).optional().personal(),
  },
  history: 'state',
  reason:
    'Entries are written once by the audit reaction and never edited; erasure tombstones them.',
  generated: { set: false, create: false },
});

export interface Entry extends EntityType<typeof entryDef> {}
export const entry: Entry = entryDef;
