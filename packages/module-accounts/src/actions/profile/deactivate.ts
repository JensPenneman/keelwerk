import { defineCommand, field, shape } from '@keelwerk/core';
import { accountsBase } from '../../base.ts';
import { profile } from '../../entities/profile.ts';

export const deactivate = defineCommand(accountsBase, profile, {
  input: shape({ reason: field.string().optional() }),
  errors: [],
  execution: 'sync',
  decide: (input, _current, ctx) => [
    ctx.events.deactivated({ at: ctx.clock.now(), reason: input.reason }),
  ],
});
