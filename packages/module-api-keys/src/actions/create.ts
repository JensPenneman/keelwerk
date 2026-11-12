import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { apiKeysBase } from '../base.ts';
import { key } from '../entities/key.ts';
import { apiKeyPrefix } from '../lib/api-key-prefix.ts';
import { normalizedScopes } from '../lib/normalized-scopes.ts';

/** Unrevoked keys one person may hold: more are refused, so a person's keys stay few enough to revoke at once. */
const keyLimit = 100;

const scopePattern = '^(read|write|transport:[a-z][a-z0-9-]{0,62})$';

/**
 * Issues a key for the signed-in person. The secret is shown exactly once: the row keeps the public
 * id and the verifier, and no receipt, event or log keeps the key (17.2.2, S-97). A key creates no
 * key, so a leaked key cannot mint keys that outlive its own revocation (rule `signedIn`).
 */
const createDef = defineCommand(apiKeysBase, {
  input: shape({
    label: field.string({ minLength: 1, maxLength: 120 }),
    scopes: field.list(field.string({ pattern: scopePattern })),
    expiresAt: field.instant().optional(),
    apiVersion: field.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }).optional(),
  }),
  output: shape({
    id: field.ref.own('key'),
    key: field.string(),
    publicId: field.string(),
    expiresAt: field.instant().optional(),
  }),
  shownOnce: ['key'],
  principal: 'user',
  execution: 'sync',
  *decide(input, ctx) {
    const scopes = normalizedScopes(input.scopes);
    const now = ctx.clock.now();
    if (input.expiresAt !== undefined && Temporal.Instant.compare(input.expiresAt, now) <= 0) {
      throw errors.validation('The expiry must lie in the future.');
    }
    const held = yield* ctx.load.apiKeys.key.count({
      subject: ctx.principal.subject,
      revokedAt: { isNull: true },
    });
    if (held >= keyLimit) {
      throw errors.conflict(`A person holds at most ${keyLimit} keys; revoke one first.`);
    }
    const id = yield* ctx.newId(key);
    const issued = yield* ctx.secrets.issue({ prefix: apiKeyPrefix });
    const { subject, subjectRef } = ctx.principal;
    return {
      events: [
        ctx.write.apiKeys.key.create({
          id,
          subject,
          ...(subjectRef === null ? {} : { subjectRef }),
          publicId: issued.publicId,
          verifier: issued.verifier,
          label: input.label,
          scopes,
          ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
          ...(input.apiVersion === undefined ? {} : { apiVersion: input.apiVersion }),
        }),
      ],
      result: {
        id,
        key: issued.plain,
        publicId: issued.publicId,
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      },
    };
  },
});

type CreatePart = typeof createDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface Create extends CreatePart {}
export const create: Create = createDef;
