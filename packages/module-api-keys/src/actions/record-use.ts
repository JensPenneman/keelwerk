import { defineCommand, field, shape } from '@keelwerk/core';
import { apiKeysBase } from '../base.ts';
import { lastUseDue } from '../lib/last-use-due.ts';

/**
 * Records the last use of a key, at most once an hour (S-140). The resolver sets it as a keyed
 * timer that holds the key id only; it runs as the module's own service principal, so a read-only
 * key's use is recorded too and no caller can invoke it from outside.
 */
const recordUseDef = defineCommand(apiKeysBase, {
  input: shape({ keyId: field.ref.own('key') }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const current = yield* ctx.load.apiKeys.key.byId(input.keyId);
    const now = ctx.clock.now();
    if (
      current === undefined ||
      current.revokedAt !== undefined ||
      !lastUseDue(current.lastUsedAt, now)
    ) {
      return [];
    }
    return [ctx.write.apiKeys.key.update(current, { lastUsedAt: now })];
  },
});

type RecordUsePart = typeof recordUseDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RecordUse extends RecordUsePart {}
export const recordUse: RecordUse = recordUseDef;
