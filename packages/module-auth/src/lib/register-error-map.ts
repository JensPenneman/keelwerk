import { registerErrors } from './register-errors.ts';

/**
 * The error map of the `invoke` of `accounts.register`: each error the registration declares is
 * named as itself, so the sign-up's client sees the code and the details it always saw (the sign-up
 * declares the same definitions, see `registerErrors`) and not the closed projection of the kind.
 */
export const registerErrorMap: Readonly<Record<string, string>> = Object.fromEntries(
  registerErrors.map((error) => [error.code, error.code]),
);
