import { defineCommand, field, shape } from '@keelwerk/core';
import { vaultBase } from '../base.ts';

export const retire = defineCommand(vaultBase, {
  input: shape({ credentialId: field.ref.own('credential') }),
  output: shape({}),
  principal: 'user',
  decide(input, ctx) {
    return {
      events: [ctx.write.vault.credential.archive(input.credentialId, { reason: 'retired' })],
      result: {},
    };
  },
});
