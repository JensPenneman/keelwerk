import { defineQuery, field, shape } from '@keelwerk/core';
import { vaultBase } from '../base.ts';

export const show = defineQuery(vaultBase, {
  input: shape({ credentialId: field.ref.own('credential') }),
  output: shape({ apiKey: field.string().optional() }),
  principal: 'user',
  *read(input, ctx) {
    const row = yield* ctx.load.vault.credential.byId(input.credentialId);
    if (row === undefined || row.apiKey === undefined) return {};
    return { apiKey: yield* ctx.secrets.reveal(row.apiKey, 'the support check') };
  },
});
