import { defineCommand } from '../../../../define-command.ts';
import { field } from '../../../../field.ts';
import { shape } from '../../../../shape.ts';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const deactivate = defineCommand(accountsBase, profile, {
  input: shape({ reason: field.string().optional() }),
  decide: (input, _current, ctx) => [
    ctx.events.deactivated({ at: ctx.clock.now(), reason: input.reason }),
  ],
});
