import { KeelwerkError } from '@keelwerk/core';
import type { StubHandler } from './inline-effect-stub.ts';

/** The stand-in for GitHub's code exchange: `good-*` codes succeed, `refused` is turned down, anything else is unavailable. */
export function exchangeHandler(calls: string[]): StubHandler {
  return async (input) => {
    const { code } = input as { readonly code: string };
    calls.push(code);
    if (code === 'refused') {
      throw new KeelwerkError({
        kind: 'unavailable',
        code: 'github.bad_verification_code',
        message: 'The code passed is incorrect or expired.',
      });
    }
    return { accountLogin: 'octo-cat', token: `ghs_${code}_abcd`, scopes: 'repo,read:org' };
  };
}
