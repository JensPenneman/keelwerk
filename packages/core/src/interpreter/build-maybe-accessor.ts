import type { MaybeRequest } from '../protocol/maybe-request.ts';
import { createRequest } from './create-request.ts';
import { isRequest } from './is-request.ts';
import type { MaybeBody } from './maybe-body.ts';
import type { RequestAuthorities } from './request-authorities.ts';

/**
 * The Maybe accessor of an optional module (decision 32b): `ifPresent(f)` is a request answered
 * with `f`'s answer when the module is selected, else with `undefined`, in which case `f` is not
 * called and the unit is not touched. `module` is the optional module's id and `present` builds the module's loads or services.
 */
export function buildMaybeAccessor(
  module: string,
  selected: boolean,
  present: () => unknown,
  authority: string,
  authorities: RequestAuthorities,
): { readonly ifPresent: (f: (present: never) => unknown) => MaybeRequest } {
  return {
    ifPresent(f) {
      if (!selected) {
        return createRequest<MaybeRequest>(
          authorities,
          { kind: 'maybe', module, present: false, inner: null },
          authority,
        );
      }
      const result = f(present() as never);
      if (isRequest(result)) {
        return createRequest<MaybeRequest>(
          authorities,
          { kind: 'maybe', module, present: true, inner: result },
          authority,
        );
      }
      return createRequest<MaybeBody>(
        authorities,
        {
          kind: 'maybe',
          module,
          present: true,
          inner: null,
          body: result,
        },
        authority,
      );
    },
  };
}
