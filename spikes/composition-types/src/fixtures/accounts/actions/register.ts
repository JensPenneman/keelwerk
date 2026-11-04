import { defineCommand } from '../../../define-command.ts';
import { defineError } from '../../../define-error.ts';
import { errors } from '../../../errors.ts';
import { field } from '../../../field.ts';
import { shape } from '../../../shape.ts';
import { accountsBase } from '../base.ts';
import { profile } from '../entities/profile.ts';

const emailTaken = defineError('accounts.email_taken', {
  kind: 'conflict',
  message: 'This e-mail address is already in use.',
  data: shape({ email: field.string() }),
});

export const register = defineCommand(accountsBase, {
  input: shape({ displayName: field.string(), email: field.string({ format: 'email' }) }),
  output: shape({ profileId: field.ref.own('profile') }),
  errors: [emailTaken],
  auth: { public: true },
  *decide(input, ctx) {
    if (!ctx.config.allowSelfRegistration) throw errors.forbidden('Self-registration is disabled.');
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
