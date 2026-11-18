import { identifierTaken } from '../errors/identifier-taken.ts';

/**
 * The error map of the `invoke` of `accounts.register`: an address that already has a profile
 * fails the sign-up as `auth.identifier_taken`, the answer 17.2.2 specifies for an address that is
 * taken, with no details. The sign-up still declares the errors of the registration (see
 * `registerErrors`) so that its surface keeps listing them.
 */
export const registerErrorMap: Readonly<Record<string, string>> = {
  'accounts.email_taken': identifierTaken.code,
};
