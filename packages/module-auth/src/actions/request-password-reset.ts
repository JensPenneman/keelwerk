import { defineCommand, field, setTimer, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { credential } from '../entities/credential.ts';
import { deliverPasswordReset } from './deliver-password-reset.ts';

/**
 * Asks for a one-time reset token (S-43). The request stores nothing and delivers nothing: it sets
 * one keyed timer whether or not the identifier exists (for a decoy id when it does not), and the
 * job `deliverPasswordReset` issues and delivers the token off the request path (17.2.5). Both
 * answers load the credential, draw an id and set one timer, and make the same calls on the store:
 * the lookup of an identifier that no credential holds reads a decoy key where a found credential
 * reads the key of its sealed identifier (the kernel does that, 17.2.2). The time of the unwrap of
 * a found key is not equalised, and the answer never carries the token.
 */
const requestPasswordResetDef = defineCommand(authBase, {
  input: shape({ identifier: field.string({ format: 'email' }).personal() }),
  output: shape({ accepted: field.boolean() }),
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    const decoy = yield* ctx.newId(credential);
    const found = yield* ctx.load.auth.credential.one({
      where: { identifier: input.identifier, kind: 'password', revokedAt: { isNull: true } },
    });
    const target = found?.id ?? decoy;
    return {
      events: [],
      effects: [
        setTimer({
          key: `passwordReset:${target}`,
          invoke: deliverPasswordReset,
          input: { credentialId: target },
          at: ctx.clock.now(),
        }),
      ],
      result: { accepted: true },
    };
  },
});

type RequestPasswordResetPart = typeof requestPasswordResetDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface RequestPasswordReset extends RequestPasswordResetPart {}
export const requestPasswordReset: RequestPasswordReset = requestPasswordResetDef;
