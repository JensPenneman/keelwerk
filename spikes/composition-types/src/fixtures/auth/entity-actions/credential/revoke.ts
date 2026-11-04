import { defineCommand } from '../../../../define-command.ts';
import { field } from '../../../../field.ts';
import { shape } from '../../../../shape.ts';
import { authBase } from '../../base.ts';
import { credential } from '../../entities/credential.ts';

export const revoke = defineCommand(authBase, credential, {
  input: shape({ reason: field.string().optional() }),
  execution: 'either',
  decide: (input, _current, ctx) => [
    ctx.events.revoked({ at: ctx.clock.now(), reason: input.reason }),
  ],
});
