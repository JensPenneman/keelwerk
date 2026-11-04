import { defineCommand, field, shape } from '@keelwerk/core';
import { accountsBase } from '../base.ts';
import { profile } from '../entities/profile.ts';
import { emailTaken } from '../errors/email-taken.ts';
import { registrationDisabled } from '../errors/registration-disabled.ts';

export const register = defineCommand(accountsBase, {
  input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken, registrationDisabled],
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw registrationDisabled();
    if (yield* ctx.load.accounts.profile.exists({ email: input.email }))
      throw emailTaken({ email: input.email });
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
