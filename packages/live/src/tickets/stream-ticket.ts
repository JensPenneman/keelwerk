import { defineEntity, type EntityType, field } from '@keelwerk/core';
import { principalRefSchema } from './principal-ref-schema.ts';

const streamTicketDef = defineEntity({
  prefix: 'stkt',
  fields: {
    /** The 26 base32 characters that find the row; the secret is never stored. */
    publicId: field.string().unique(),
    /** The keyed HMAC-SHA-256 of the secret (the key service), so a dump opens no stream. */
    verifier: field.verifier(),
    /** The reference of the principal the ticket stands for, re-resolved at open and at every revalidation. */
    principal: field.json(principalRefSchema).hidden(),
    principalResolver: field.string(),
    principalId: field.string(),
    /** The subscription the ticket is bound to; absent: any subscription of the endpoint. */
    action: field.string().optional(),
    endpoint: field.enum(['subscribe']),
    /** The instant the ticket stops being valid: it is valid while the clock is before it; a purge by it finds its rows by this index. */
    expiresAt: field.instant().index(),
    usedAt: field.instant().optional(),
  },
  history: 'state',
  tenancy: 'invocation',
  reason:
    'A ticket lives for a minute and is spent once; it is a credential, not a fact of the domain. It lives in the scope of the session that issued it, tenant or backend, so its tenancy is invocation.',
  generated: {
    get: false,
    query: false,
    changes: false,
    queryChanges: false,
    set: false,
    create: false,
    history: false,
    watch: false,
  },
});

export interface StreamTicket extends EntityType<typeof streamTicketDef> {}
/** The single-use ticket of a stream (S-161): stored as a keyed verifier, spent by a conditional update. */
export const streamTicket: StreamTicket = streamTicketDef;
