import { defineCommand } from '@keelwerk/core';
import { apiKeysBase } from '../../base.ts';
import { key } from '../../entities/key.ts';

/**
 * Revokes a key: it stops resolving at once, and queued work stored under its reference (an
 * asynchronous command, an enqueue effect) and the open streams of it end at their next
 * re-resolution. Timers, reactions and effect continuations that the key's commands caused run as
 * the module's system principal and complete after the revocation, by design (docs/architecture.md,
 * about line 3407): a decision already accepted still completes.
 */
export const revoke = defineCommand(apiKeysBase, key, {
  execution: 'sync',
  decide: (_input, current, ctx) => [
    ctx.write.apiKeys.key.update(current, { revokedAt: ctx.clock.now() }),
  ],
});
