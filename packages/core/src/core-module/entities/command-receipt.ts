import { defineEntity } from '../../dsl/define-entity.ts';
import { field } from '../../fields/field.ts';
import type { StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';
import type { CoreBase } from '../core-base-type.ts';

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { value: { ...value } as Record<string, unknown> }
      : { issues: [{ message: 'Expected an object.' }] },
  /** Standard JSON Schema, so the surface can describe the field (section 16.2.3). */
  jsonSchema: {
    input: () => ({ type: 'object' }),
    output: () => ({ type: 'object' }),
  },
};

/** The documents a receipt keeps: the principal reference and the outcome. */
const documentSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> = {
  '~standard': standard,
};

/**
 * The `core.commandReceipt` entity (S-26, section 15.1.7): the fields of the `Receipt` the stores
 * read and write. Only the kernel writes receipts, and its tenancy is `invocation`.
 */
export const commandReceipt: CoreBase['entities']['commandReceipt'] = defineEntity({
  prefix: 'rcpt',
  fields: {
    commandId: field.string().unique(),
    action: field.string(),
    fingerprint: field.string(),
    /** The principal reference document; hidden from reads, the flat columns below carry the identity. */
    principal: field.json(documentSchema).optional().hidden(),
    /** The flat copy of `principal.resolver`: a principal is the pair (resolver, principalId), section 8.5. */
    principalResolver: field.string().optional(),
    /** The flat copy of `principal.principalId`: rule conditions compare flat columns only. */
    principalId: field.string().optional(),
    status: field.enum(['pending', 'accepted', 'completed', 'failed']),
    outcome: field.json(documentSchema).optional(),
    apiVersion: field.string(),
    transport: field.string(),
    remoteAddress: field.string().optional(),
    userAgent: field.string().optional(),
    clientId: field.string().optional(),
    clientSeq: field.integer().optional(),
    expiresAt: field.instant(),
    acknowledgedAt: field.instant().optional(),
  },
  history: 'state',
  tenancy: 'invocation',
  generated: { set: false },
});
