import { defineCommand, errors, field, shape } from '@keelwerk/core';
import { accountsBase } from '../base.ts';
import { profile } from '../entities/profile.ts';
import { emailTaken } from '../errors/email-taken.ts';

export const register = defineCommand(accountsBase, {
  input: shape({
    displayName: field.string({ maxLength: 120 }),
    email: field.string({ format: 'email' }),
  }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken],
  execution: 'sync',
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.');
    if (yield* ctx.load.accounts.profile.exists({ email: input.email })) {
      throw emailTaken({ email: input.email });
    }
    const id = yield* ctx.newId(profile);
    return {
      events: [
        ctx.write.accounts.profile.create({
          id,
          displayName: input.displayName,
          email: input.email,
        }),
      ],
      result: { profileId: id },
    };
  },
});
