import { defineCommand, field, shape } from '@keelwerk/core';
import { vaultBase } from '../base.ts';

export const replace = defineCommand(vaultBase, {
  input: shape({ credentialId: field.ref.own('credential'), apiKey: field.secret() }),
  output: shape({}),
  principal: 'user',
  decide(input, ctx) {
    return {
      events: [
        ctx.write.vault.credential.update(input.credentialId, {
          apiKey: input.apiKey,
        }),
      ],
      result: {},
    };
  },
});
