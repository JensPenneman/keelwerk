import { defineCommand, field, shape } from '@keelwerk/core';
import { apiKeysBase } from '../base.ts';

const pageSize = 1000;

/**
 * Revokes every live key of a subject; internal and asynchronous: the module's own reaction to a
 * deactivation enqueues it under `api-keys.system`, so the deactivating unit writes no key and no
 * caller reaches it from outside. Queued work stored under a revoked key
 * ends at its next re-resolution.
 */
const revokeSubjectDef = defineCommand(apiKeysBase, {
  input: shape({ subject: field.subject(), reason: field.string() }),
  internal: true,
  execution: 'async',
  *decide(input, ctx) {
    const at = ctx.clock.now();
    const writes = [];
    let after: string | undefined;
    // Pages by id, because the writes land only when the unit ends and none may stay live.
    for (;;) {
      const keys = yield* ctx.load.apiKeys.key.many({
        where: {
          subject: input.subject,
          revokedAt: { isNull: true },
          ...(after === undefined ? {} : { id: { gt: after as never } }),
        },
        sort: [{ field: 'id', direction: 'asc' }],
        limit: pageSize,
      });
      writes.push(...keys.map((row) => ctx.write.apiKeys.key.update(row, { revokedAt: at })));
      const last = keys.at(-1);
      if (last === undefined || keys.length < pageSize) return writes;
      after = last.id;
    }
  },
});

type RevokeSubjectPart = typeof revokeSubjectDef;
/** The action's type, named once so the reaction and the manifest do not repeat it. */
export interface RevokeSubject extends RevokeSubjectPart {}
export const revokeSubject: RevokeSubject = revokeSubjectDef;
