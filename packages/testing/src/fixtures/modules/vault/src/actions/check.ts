import { defineQuery, field, shape } from '@keelwerk/core';
import { vaultBase } from '../base.ts';

export const check = defineQuery(vaultBase, {
  input: shape({ credentialId: field.ref.own('credential'), token: field.string() }),
  output: shape({ valid: field.boolean() }),
  principal: 'user',
  *read(input, ctx) {
    const row = yield* ctx.load.vault.credential.byId(input.credentialId);
    if (row === undefined || row.tokenVerifier === undefined) return { valid: false };
    return { valid: yield* ctx.secrets.verify(input.token, row.tokenVerifier) };
  },
});
