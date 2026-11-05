import { defineCommand, field, shape } from '@keelwerk/core';
import { vaultBase } from '../base.ts';
import { credential } from '../entities/credential.ts';

export const store = defineCommand(vaultBase, {
  input: shape({ label: field.string({ maxLength: 100 }), apiKey: field.secret().optional() }),
  output: shape({ credentialId: field.ref.own('credential'), token: field.string() }),
  principal: 'user',
  trace: { input: 'sealed' },
  *decide(input, ctx) {
    const id = yield* ctx.newId(credential);
    const issued = yield* ctx.secrets.issue({ prefix: 'vlt' });
    return {
      events: [
        ctx.write.vault.credential.create({
          id,
          label: input.label,
          apiKey: input.apiKey,
          publicId: issued.publicId,
          tokenVerifier: issued.verifier,
        }),
      ],
      result: { credentialId: id, token: issued.plain },
    };
  },
});
