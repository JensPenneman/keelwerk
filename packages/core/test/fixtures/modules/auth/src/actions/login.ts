import { defineCommand, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { session } from '../entities/session.ts';

export const login = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }), password: field.secret() }),
  output: shape({ sessionToken: field.string(), sessionId: field.ref.own('session') }),
  auth: { public: true },
  *decide(input, ctx) {
    const cred = yield* ctx.load.auth.credential.one({
      where: { identifier: input.identifier, revokedAt: { isNull: true } },
    });
    const ok = yield* ctx.compute.argon2idVerify(cred?.verifier ?? '', input.password);
    if (!cred || !ok) return [];
    const [id, token] = yield* ctx.all([ctx.newId(session), ctx.secrets.issue({ prefix: 'pss' })]);
    return {
      events: [
        ctx.write.auth.session.create({
          id,
          subject: cred.subject,
          credentialId: cred.id,
          publicId: token.publicId,
          tokenVerifier: token.verifier,
        }),
        ctx.write.auth.credential.update(cred, { lastUsedAt: ctx.clock.now() }),
      ],
      result: { sessionToken: token.plain, sessionId: id },
    };
  },
});
