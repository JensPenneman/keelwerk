import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { authBase } from '../base.ts';
import { credential } from '../entities/credential.ts';
import { identifierTaken } from '../errors/identifier-taken.ts';
import { tooManyRecords } from '../errors/too-many-records.ts';
import { opaqueSubject } from '../lib/opaque-subject.ts';
import { registerErrors } from '../lib/register-errors.ts';

const subjectBytes = 16;
const saltBytes = 16;

/**
 * Creates a password credential under a fresh opaque subject and records the sign-up as a domain event (S-40).
 * With accounts selected the credential is marked `linkPending` so that only the profile this sign-up creates
 * claims it (an interim guard until reaction events carry a causation id, 7.7).
 */
const signUpDef = defineCommand(authBase, {
  input: shape({
    identifier: field.string({ format: 'email' }),
    password: field.secret(),
    displayName: field.string({ maxLength: 120 }).optional(),
  }),
  output: shape({ credentialId: field.ref.own('credential') }),
  errors: [identifierTaken, tooManyRecords, ...registerErrors],
  auth: { public: true },
  execution: 'sync',
  *decide(input, ctx) {
    // With accounts selected its gate comes first, so a closed registration answers every address alike.
    const open = yield* ctx.services.accounts.ifPresent((accounts) => accounts.registrationOpen());
    if (open === false) throw errors.forbidden('Self-registration is disabled.');
    const taken = yield* ctx.load.auth.credential.exists({
      identifier: input.identifier,
      kind: 'password',
      revokedAt: { isNull: true },
    });
    if (taken) throw identifierTaken();
    const id = yield* ctx.newId(credential);
    const subject = opaqueSubject(yield* ctx.random(subjectBytes));
    const salt = yield* ctx.random(saltBytes);
    const verifier = yield* ctx.compute.argon2idHash(input.password, salt);
    return {
      events: [
        ctx.write.auth.credential.create({
          id,
          subject,
          kind: 'password',
          identifier: input.identifier,
          verifier,
          linkPending: open !== undefined,
        }),
        ctx.write.auth.credential.signedUp(id, { displayName: input.displayName }),
      ],
      result: { credentialId: id },
    };
  },
});

type SignUpPart = typeof signUpDef;
/** The action's type, named once so the rules and the manifest do not repeat it. */
export interface SignUp extends SignUpPart {}
export const signUp: SignUp = signUpDef;
