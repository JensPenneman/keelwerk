import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const revoke = defineCommand(authBase, credential, {
  input: shape({ reason: field.string().optional() }),
  execution: 'sync',
  decide: (input, _current, ctx) => [
    ctx.events.revoked({ at: ctx.clock.now(), reason: input.reason }),
  ],
});
