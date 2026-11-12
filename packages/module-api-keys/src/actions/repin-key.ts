import { defineCommand, field, shape } from '@keelwerk/core';
import { apiKeysBase } from '../base.ts';

/**
 * Moves the stored API-version pin of a key that was pinned to a retired version (18.5). The
 * resolver serves such a key at the target at once and sets this as a keyed timer; it runs as the
 * module's own service principal, so a read-only key is re-pinned too and no caller can invoke it.
 */
const repinKeyDef = defineCommand(apiKeysBase, {
  input: shape({
    keyId: field.ref.own('key'),
    apiVersion: field.string({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  }),
  principal: 'service',
  execution: 'sync',
  *decide(input, ctx) {
    const current = yield* ctx.load.apiKeys.key.byId(input.keyId);
    if (current === undefined || current.apiVersion === input.apiVersion) return [];
    return [ctx.write.apiKeys.key.update(current, { apiVersion: input.apiVersion })];
  },
});

type RepinKeyPart = typeof repinKeyDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RepinKey extends RepinKeyPart {}
export const repinKey: RepinKey = repinKeyDef;
